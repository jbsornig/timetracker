const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { refreshInvoiceStatus } = require('./invoice-status');

function makeDb(invoice) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, total_amount REAL, amount_paid REAL,
    status TEXT, paid_date TEXT, voided_date TEXT)`);
  db.exec('CREATE TABLE payments (id INTEGER PRIMARY KEY, invoice_id INTEGER, amount REAL, payment_date TEXT)');
  db.prepare(`INSERT INTO invoices (id, total_amount, amount_paid, status, paid_date, voided_date)
    VALUES (1, @total_amount, @amount_paid, @status, @paid_date, @voided_date)`)
    .run({ paid_date: null, voided_date: null, ...invoice });
  return db;
}

function getInvoice(db) {
  return db.prepare('SELECT status, paid_date FROM invoices WHERE id = 1').get();
}

test('a credit that brings the total down to what was paid marks the invoice paid on the last payment date', () => {
  const db = makeDb({ total_amount: 21318, amount_paid: 21318, status: 'partial' });
  db.prepare("INSERT INTO payments (invoice_id, amount, payment_date) VALUES (1, 21000, '2026-08-20'), (1, 318, '2026-08-28')").run();
  refreshInvoiceStatus(db, 1);
  assert.deepStrictEqual(getInvoice(db), { status: 'paid', paid_date: '2026-08-28' });
});

test('a paid invoice keeps its existing paid date', () => {
  const db = makeDb({ total_amount: 1000, amount_paid: 1000, status: 'paid', paid_date: '2026-07-01' });
  refreshInvoiceStatus(db, 1);
  assert.deepStrictEqual(getInvoice(db), { status: 'paid', paid_date: '2026-07-01' });
});

test('a charge added to a paid invoice makes it partial and clears the paid date', () => {
  const db = makeDb({ total_amount: 1500, amount_paid: 1000, status: 'paid', paid_date: '2026-07-01' });
  refreshInvoiceStatus(db, 1);
  assert.deepStrictEqual(getInvoice(db), { status: 'partial', paid_date: null });
});

test('an invoice with nothing paid is unpaid', () => {
  const db = makeDb({ total_amount: 1500, amount_paid: 0, status: 'partial' });
  refreshInvoiceStatus(db, 1);
  assert.deepStrictEqual(getInvoice(db), { status: 'unpaid', paid_date: null });
});

test('a fraction of a cent left over still counts as paid', () => {
  const db = makeDb({ total_amount: 100.004, amount_paid: 100, status: 'partial' });
  refreshInvoiceStatus(db, 1);
  assert.strictEqual(getInvoice(db).status, 'paid');
});

test('a voided invoice is left alone', () => {
  const db = makeDb({ total_amount: 100, amount_paid: 100, status: 'voided', voided_date: '2026-09-01' });
  refreshInvoiceStatus(db, 1);
  assert.deepStrictEqual(getInvoice(db), { status: 'voided', paid_date: null });
});
