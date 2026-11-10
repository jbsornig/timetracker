const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const poLines = require('./po-line-billing');

const PROJECT_ID = 1;
const ENGINEER_ID = 10;
const OTHER_ENGINEER_ID = 11;

// The FCA PO 81168072 layout: line 1 is engineer-built, lines 2-5 are billed by the admin
const FCA_LINES = [
  { line: 1, description: 'Error proofing Complete Assembly', qty: 6, price: 4000, engineer: ENGINEER_ID, pay: 2500 },
  { line: 2, description: '6 port Gigabyte switch', qty: 6, price: 200 },
  { line: 3, description: 'M12 male to female cable (4)', qty: 22, price: 150 },
  { line: 4, description: 'RJ45 to M12 Ethernet Cable (4)', qty: 22, price: 150 },
  { line: 5, description: 'Onsite Startup Per System (12 Hrs/Systm)', qty: 6, price: 1800 },
];

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, unit_price REAL DEFAULT 0);
    CREATE TABLE engineer_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_id INTEGER, pay_rate REAL, bill_rate REAL);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, voided_date DATE);
    CREATE TABLE timesheets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_id INTEGER, status TEXT DEFAULT 'draft',
      units REAL DEFAULT 0, amount REAL DEFAULT 0, invoice_id INTEGER, period_start DATE, period_end DATE);
    CREATE TABLE customer_po_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, line_number INTEGER, description TEXT,
      engineer_id INTEGER, edi_uom TEXT DEFAULT '', edi_po_quantity REAL DEFAULT 0, edi_unit_price REAL DEFAULT 0, po_line_amount REAL DEFAULT 0);
  `);
  poLines.migratePoLineBilling(db);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?), (?, ?)').run(ENGINEER_ID, 'Pat Builder', OTHER_ENGINEER_ID, 'Sam Other');
  db.prepare('INSERT INTO projects (id) VALUES (?)').run(PROJECT_ID);
  const insertLine = db.prepare(`INSERT INTO customer_po_lines
    (project_id, line_number, description, engineer_id, edi_uom, edi_po_quantity, edi_unit_price, po_line_amount, pay_per_unit)
    VALUES (?, ?, ?, ?, 'EA', ?, ?, ?, ?)`);
  FCA_LINES.forEach(l => insertLine.run(PROJECT_ID, l.line, l.description, l.engineer || null, l.qty, l.price, l.qty * l.price, l.pay || 0));
  return db;
}

function addSubmission(db, { units, status = 'approved', lineNumber = 1, invoiceId = null }) {
  return db.prepare(`INSERT INTO timesheets (user_id, project_id, status, units, amount, invoice_id, po_line_number, bill_unit_price, period_start, period_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, 4000, '2026-11-01', '2026-11-30')`)
    .run(ENGINEER_ID, PROJECT_ID, status, units, units * 2500, invoiceId, lineNumber).lastInsertRowid;
}

function addInvoice(db, { voided = false } = {}) {
  return db.prepare('INSERT INTO invoices (project_id, voided_date) VALUES (?, ?)').run(PROJECT_ID, voided ? '2026-11-20' : null).lastInsertRowid;
}

function lineStatus(db, lineNumber) {
  return poLines.getPoLineStatus(db, PROJECT_ID).find(l => l.line_number === lineNumber);
}

describe('po-line-billing', () => {
  let db;
  beforeEach(() => { db = createDatabase(); });

  describe('getPoLineStatus', () => {
    it('counts reported units against the line but ignores rejected submissions', () => {
      addSubmission(db, { units: 2, status: 'submitted' });
      addSubmission(db, { units: 3, status: 'rejected' });
      assert.equal(lineStatus(db, 1).remaining_units, 4);
    });

    it('counts admin-billed quantities except on voided invoices', () => {
      const items = poLines.buildBilledLineItems(db, PROJECT_ID, [{ line_number: 3, quantity: 10 }]);
      poLines.saveBilledLineItems(db, addInvoice(db), items);
      poLines.saveBilledLineItems(db, addInvoice(db, { voided: true }), items);
      assert.equal(lineStatus(db, 3).remaining_units, 12);
    });

    it('reports approved units that are not on an invoice yet', () => {
      addSubmission(db, { units: 2 });
      addSubmission(db, { units: 1, invoiceId: addInvoice(db) });
      assert.equal(lineStatus(db, 1).approved_unbilled_units, 2);
    });
  });

  describe('resolveEngineerLine', () => {
    it('picks the only line assigned to the engineer', () => {
      assert.equal(poLines.resolveEngineerLine(db, PROJECT_ID, ENGINEER_ID).line_number, 1);
    });

    it('rejects an engineer who has no line on the PO', () => {
      assert.throws(() => poLines.resolveEngineerLine(db, PROJECT_ID, OTHER_ENGINEER_ID), /not assigned to a line/);
    });

    it('rejects a line that belongs to someone else', () => {
      assert.throws(() => poLines.resolveEngineerLine(db, PROJECT_ID, ENGINEER_ID, 2), /not assigned to PO line 2/);
    });
  });

  describe('priceEngineerUnits', () => {
    it('pays the line rate and snapshots the customer price', () => {
      const line = poLines.resolveEngineerLine(db, PROJECT_ID, ENGINEER_ID);
      assert.deepEqual(poLines.priceEngineerUnits(line, 3), { amount: 7500, bill_unit_price: 4000 });
    });

    it('refuses more units than remain on the PO line', () => {
      addSubmission(db, { units: 5 });
      const line = poLines.resolveEngineerLine(db, PROJECT_ID, ENGINEER_ID);
      assert.throws(() => poLines.priceEngineerUnits(line, 2), /Only 1 units remain on PO line 1/);
    });

    it('lets an edited submission reuse its own units', () => {
      const id = addSubmission(db, { units: 6, status: 'draft' });
      const line = poLines.resolveEngineerLine(db, PROJECT_ID, ENGINEER_ID, 1, { excludeTimesheetId: id });
      assert.equal(poLines.priceEngineerUnits(line, 6).amount, 15000);
    });
  });

  describe('buildBilledLineItems', () => {
    it('prices quantities at the PO unit price and combines repeated lines', () => {
      const items = poLines.buildBilledLineItems(db, PROJECT_ID, [
        { line_number: 2, quantity: 6 }, { line_number: 3, quantity: 10 }, { line_number: 3, quantity: 12 }, { line_number: 4, quantity: 0 },
      ]);
      assert.deepEqual(items.map(i => [i.po_line_number, i.units, i.amount]), [[2, 6, 1200], [3, 22, 3300]]);
    });

    it('refuses to bill an engineer line directly', () => {
      assert.throws(() => poLines.buildBilledLineItems(db, PROJECT_ID, [{ line_number: 1, quantity: 1 }]), /assigned to Pat Builder/);
    });

    it('refuses more than the PO quantity', () => {
      assert.throws(() => poLines.buildBilledLineItems(db, PROJECT_ID, [{ line_number: 5, quantity: 7 }]), /Only 6 units remain/);
    });

    it('refuses a negative quantity', () => {
      assert.throws(() => poLines.buildBilledLineItems(db, PROJECT_ID, [{ line_number: 2, quantity: -1 }]), /positive number/);
    });
  });

  describe('assertInvoiceRestorable', () => {
    function billVoidedInvoice(quantity) {
      const invoiceId = addInvoice(db, { voided: true });
      poLines.saveBilledLineItems(db, invoiceId, poLines.buildBilledLineItems(db, PROJECT_ID, [{ line_number: 2, quantity }]));
      return invoiceId;
    }

    it('allows unvoiding when its quantities still fit on the PO', () => {
      const voidedId = billVoidedInvoice(4);
      assert.doesNotThrow(() => poLines.assertInvoiceRestorable(db, voidedId));
    });

    it('blocks unvoiding once the quantities were billed again on another invoice', () => {
      const voidedId = billVoidedInvoice(6);
      poLines.saveBilledLineItems(db, addInvoice(db), poLines.buildBilledLineItems(db, PROJECT_ID, [{ line_number: 2, quantity: 6 }]));
      assert.throws(() => poLines.assertInvoiceRestorable(db, voidedId), /Cannot unvoid: PO line 2 .* only 0 units remain/);
    });

    it('allows unvoiding an invoice with no billed PO lines', () => {
      assert.doesNotThrow(() => poLines.assertInvoiceRestorable(db, addInvoice(db, { voided: true })));
    });
  });

  describe('getPieceRateInvoiceItems', () => {
    it('bills the whole FCA PO as one row per line in line order', () => {
      const invoiceId = addInvoice(db);
      addSubmission(db, { units: 4, invoiceId });
      addSubmission(db, { units: 2, invoiceId });
      const billed = poLines.buildBilledLineItems(db, PROJECT_ID, [2, 3, 4, 5].map(n => ({
        line_number: n, quantity: FCA_LINES.find(l => l.line === n).qty,
      })));
      poLines.saveBilledLineItems(db, invoiceId, billed);

      const { items } = poLines.getPieceRateInvoiceItems(db, invoiceId, 0);
      assert.deepEqual(items.map(i => [i.po_line_number, i.units, i.amount]), [
        [1, 6, 24000], [2, 6, 1200], [3, 22, 3300], [4, 22, 3300], [5, 6, 10800],
      ]);
      assert.equal(items.reduce((s, i) => s + i.amount, 0), 42600);
      assert.equal(items[0].engineer_amount, 15000);
    });

    it('falls back to the project unit price for submissions without a PO line', () => {
      const invoiceId = addInvoice(db);
      db.prepare(`INSERT INTO timesheets (user_id, project_id, status, units, amount, invoice_id) VALUES (?, ?, 'approved', 3, 30, ?)`)
        .run(ENGINEER_ID, PROJECT_ID, invoiceId);
      const { items } = poLines.getPieceRateInvoiceItems(db, invoiceId, 50);
      assert.deepEqual(items.map(i => [i.is_po_line, i.units, i.unit_price, i.amount]), [[undefined, 3, 50, 150]]);
    });
  });

  describe('assertLinesRemovable', () => {
    it('allows removing lines with no activity', () => {
      assert.doesNotThrow(() => poLines.assertLinesRemovable(db, PROJECT_ID, [1, 2, 3, 4]));
    });

    it('blocks removing a line with reported units', () => {
      addSubmission(db, { units: 1, status: 'draft' });
      assert.throws(() => poLines.assertLinesRemovable(db, PROJECT_ID, [2, 3, 4, 5]), /Cannot remove line 1/);
    });
  });

  describe('ensureLineEngineersAssigned', () => {
    it('assigns a line engineer to the project once, at the line pay rate', () => {
      const lines = poLines.getPoLineStatus(db, PROJECT_ID);
      assert.deepEqual(poLines.ensureLineEngineersAssigned(db, PROJECT_ID, lines), [ENGINEER_ID]);
      assert.deepEqual(poLines.ensureLineEngineersAssigned(db, PROJECT_ID, lines), []);
      const assignment = db.prepare('SELECT pay_rate, bill_rate FROM engineer_projects WHERE user_id = ?').get(ENGINEER_ID);
      assert.deepEqual({ ...assignment }, { pay_rate: 2500, bill_rate: 4000 });
    });
  });
});
