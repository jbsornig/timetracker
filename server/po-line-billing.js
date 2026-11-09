// Per-line billing for piece-rate projects with customer PO lines.
// Each PO line has a quantity and a unit price from the customer's PO. A line with an engineer is
// billed from the units that engineer reports (paid at the line's pay_per_unit); a line without an
// engineer is billed by the admin entering a quantity when generating the invoice.
// Lines are referenced by line_number because the project form re-saves PO lines with new row ids.

const CLAIM_STATUSES = "('draft', 'submitted', 'approved')";
const QUANTITY_TOLERANCE = 0.0001;

class PoLineBillingError extends Error {}

function roundToCents(value) {
  return Math.round((value || 0) * 100) / 100;
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migratePoLineBilling(db) {
  addColumnIfMissing(db, 'customer_po_lines', 'pay_per_unit', 'REAL DEFAULT 0');
  addColumnIfMissing(db, 'timesheets', 'po_line_number', 'INTEGER');
  addColumnIfMissing(db, 'timesheets', 'bill_unit_price', 'REAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_po_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      line_number INTEGER NOT NULL,
      description TEXT,
      uom TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_invoice_po_line_items_invoice_id ON invoice_po_line_items(invoice_id)');
}

function hasPoLines(db, projectId) {
  return !!db.prepare('SELECT 1 FROM customer_po_lines WHERE project_id = ? LIMIT 1').get(projectId);
}

function sumByLine(rows) {
  return new Map(rows.map(r => [r.line_number, r.quantity || 0]));
}

function getLineUsage(db, projectId, excludeTimesheetId) {
  const reported = db.prepare(`
    SELECT po_line_number AS line_number, SUM(COALESCE(units, 0)) AS quantity
    FROM timesheets
    WHERE project_id = ? AND po_line_number IS NOT NULL AND status IN ${CLAIM_STATUSES} AND id != ?
    GROUP BY po_line_number
  `).all(projectId, excludeTimesheetId || -1);
  const billed = db.prepare(`
    SELECT ipl.line_number, SUM(ipl.quantity) AS quantity
    FROM invoice_po_line_items ipl
    JOIN invoices i ON i.id = ipl.invoice_id
    WHERE i.project_id = ? AND i.voided_date IS NULL
    GROUP BY ipl.line_number
  `).all(projectId);
  const awaitingInvoice = db.prepare(`
    SELECT po_line_number AS line_number, SUM(COALESCE(units, 0)) AS quantity
    FROM timesheets
    WHERE project_id = ? AND po_line_number IS NOT NULL AND status = 'approved' AND invoice_id IS NULL
    GROUP BY po_line_number
  `).all(projectId);
  return { reported: sumByLine(reported), billed: sumByLine(billed), awaitingInvoice: sumByLine(awaitingInvoice) };
}

// PO lines with how many units are reported, billed and still available
function getPoLineStatus(db, projectId, { excludeTimesheetId } = {}) {
  const lines = db.prepare(`
    SELECT cpl.*, u.name AS engineer_name
    FROM customer_po_lines cpl
    LEFT JOIN users u ON u.id = cpl.engineer_id
    WHERE cpl.project_id = ?
    ORDER BY cpl.line_number
  `).all(projectId);
  const usage = getLineUsage(db, projectId, excludeTimesheetId);
  return lines.map(line => {
    const reportedUnits = usage.reported.get(line.line_number) || 0;
    const billedUnits = usage.billed.get(line.line_number) || 0;
    return {
      ...line,
      reported_units: reportedUnits,
      billed_units: billedUnits,
      approved_unbilled_units: usage.awaitingInvoice.get(line.line_number) || 0,
      remaining_units: (line.edi_po_quantity || 0) - reportedUnits - billedUnits,
    };
  });
}

function getEngineerPoLines(db, projectId, userId, options) {
  return getPoLineStatus(db, projectId, options).filter(l => l.engineer_id === Number(userId));
}

// Picks the PO line an engineer's units belong to
function resolveEngineerLine(db, projectId, userId, requestedLineNumber, options) {
  const lines = getEngineerPoLines(db, projectId, userId, options);
  if (lines.length === 0) {
    throw new PoLineBillingError('You are not assigned to a line on this PO. Ask the admin to assign you to a PO line.');
  }
  if (requestedLineNumber === undefined || requestedLineNumber === null || requestedLineNumber === '') {
    if (lines.length > 1) throw new PoLineBillingError('Choose which PO line these units are for.');
    return lines[0];
  }
  const line = lines.find(l => l.line_number === Number(requestedLineNumber));
  if (!line) throw new PoLineBillingError(`You are not assigned to PO line ${requestedLineNumber}.`);
  return line;
}

function assertUnitsAvailable(line, units) {
  if (units > line.remaining_units + QUANTITY_TOLERANCE) {
    const remaining = Math.max(0, line.remaining_units);
    throw new PoLineBillingError(`Only ${formatQuantity(remaining)} units remain on PO line ${line.line_number} (${line.description || 'no description'}).`);
  }
}

// Engineer pay and the snapshotted customer price for units reported on a line
function priceEngineerUnits(line, units) {
  assertUnitsAvailable(line, units);
  return { amount: roundToCents(units * (line.pay_per_unit || 0)), bill_unit_price: line.edi_unit_price || 0 };
}

function poLineFields(line) {
  return {
    is_po_line: true,
    is_piece_rate: true,
    po_line_number: line.line_number,
    description: line.description || '',
    edi_uom: line.edi_uom || '',
    edi_po_quantity: line.edi_po_quantity || 0,
  };
}

// Invoice line item for a piece-rate submission; PO-line submissions carry their line's details
function buildPieceRateItem(ts, { line, fallbackUnitPrice }) {
  const units = ts.units || 0;
  const unitPrice = ts.bill_unit_price ?? fallbackUnitPrice ?? 0;
  const item = {
    engineer: ts.engineer_name,
    units,
    unit_price: unitPrice,
    engineer_amount: ts.amount || 0,
    amount: roundToCents(units * unitPrice),
    period_start: ts.period_start,
    period_end: ts.period_end,
    is_piece_rate: true,
  };
  if (!line) return item;
  return { ...item, ...poLineFields(line), edi_unit_price: unitPrice };
}

// Customer-facing invoices show one row per PO line and price
function mergePoLineItems(items) {
  const merged = items.reduce((acc, item) => {
    if (!item.is_po_line) return [...acc, item];
    const index = acc.findIndex(m => m.is_po_line && m.po_line_number === item.po_line_number && m.unit_price === item.unit_price);
    if (index === -1) return [...acc, item];
    const existing = acc[index];
    const combined = {
      ...existing,
      engineer: existing.engineer === item.engineer ? existing.engineer : [existing.engineer, item.engineer].filter(Boolean).join(', '),
      units: existing.units + item.units,
      amount: roundToCents(existing.amount + item.amount),
      engineer_amount: roundToCents((existing.engineer_amount || 0) + (item.engineer_amount || 0)),
    };
    return acc.map((m, i) => (i === index ? combined : m));
  }, []);
  const lineItems = merged.filter(i => i.is_po_line).sort((a, b) => a.po_line_number - b.po_line_number);
  return [...lineItems, ...merged.filter(i => !i.is_po_line)];
}

// Quantities the admin bills on lines without an engineer
function buildBilledLineItems(db, projectId, quantities) {
  const totals = (quantities || []).reduce((acc, q) => {
    const quantity = Number(q.quantity);
    if (!quantity) return acc;
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new PoLineBillingError(`Quantity for PO line ${q.line_number} must be a positive number.`);
    }
    const lineNumber = Number(q.line_number);
    return acc.set(lineNumber, (acc.get(lineNumber) || 0) + quantity);
  }, new Map());
  if (totals.size === 0) return [];

  const lines = getPoLineStatus(db, projectId);
  return [...totals.entries()].map(([lineNumber, quantity]) => {
    const line = lines.find(l => l.line_number === lineNumber);
    if (!line) throw new PoLineBillingError(`PO line ${lineNumber} does not exist on this project.`);
    if (line.engineer_id) {
      throw new PoLineBillingError(`PO line ${lineNumber} is assigned to ${line.engineer_name}; it is billed from their approved units.`);
    }
    assertUnitsAvailable(line, quantity);
    const unitPrice = line.edi_unit_price || 0;
    return { ...poLineFields(line), units: quantity, unit_price: unitPrice, edi_unit_price: unitPrice, amount: roundToCents(quantity * unitPrice) };
  });
}

function saveBilledLineItems(db, invoiceId, items) {
  const insert = db.prepare(`
    INSERT INTO invoice_po_line_items (invoice_id, line_number, description, uom, quantity, unit_price, amount)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  items.forEach(item => insert.run(invoiceId, item.po_line_number, item.description, item.edi_uom, item.units, item.unit_price, item.amount));
}

function getBilledLineItems(db, invoiceId) {
  return db.prepare('SELECT * FROM invoice_po_line_items WHERE invoice_id = ? ORDER BY line_number, id').all(invoiceId)
    .map(row => ({
      is_po_line: true,
      is_piece_rate: true,
      po_line_number: row.line_number,
      description: row.description || '',
      edi_uom: row.uom || '',
      units: row.quantity,
      unit_price: row.unit_price,
      edi_unit_price: row.unit_price,
      amount: row.amount,
    }));
}

function getBilledLineQuantities(db, invoiceId) {
  return db.prepare('SELECT line_number, SUM(quantity) AS quantity FROM invoice_po_line_items WHERE invoice_id = ? GROUP BY line_number')
    .all(invoiceId);
}

function deleteBilledLineItems(db, invoiceId) {
  db.prepare('DELETE FROM invoice_po_line_items WHERE invoice_id = ?').run(invoiceId);
}

// Stamped piece-rate submissions plus admin-billed lines for an existing invoice, merged per PO line
function getPieceRateInvoiceItems(db, invoiceId, fallbackUnitPrice) {
  const timesheets = db.prepare(`
    SELECT ts.*, u.name AS engineer_name
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    WHERE ts.invoice_id = ?
    ORDER BY u.name, ts.period_start
  `).all(invoiceId);
  const projectRow = db.prepare('SELECT project_id FROM invoices WHERE id = ?').get(invoiceId);
  const lines = projectRow ? getPoLineStatus(db, projectRow.project_id) : [];
  const submitted = timesheets.map(ts => buildPieceRateItem(ts, {
    line: lines.find(l => l.line_number === ts.po_line_number),
    fallbackUnitPrice,
  }));
  return { timesheets, items: mergePoLineItems([...submitted, ...getBilledLineItems(db, invoiceId)]) };
}

// Refuses to drop PO lines that already have units reported or billed against them
function assertLinesRemovable(db, projectId, keptLineNumbers) {
  const kept = new Set(keptLineNumbers.map(Number));
  const inUse = getPoLineStatus(db, projectId)
    .filter(l => !kept.has(l.line_number) && (l.reported_units > 0 || l.billed_units > 0));
  if (inUse.length > 0) {
    const names = inUse.map(l => `line ${l.line_number}`).join(', ');
    throw new PoLineBillingError(`Cannot remove ${names}: units have already been reported or billed on it.`);
  }
}

// Engineers on a PO line must be assigned to the project so they can submit units
function ensureLineEngineersAssigned(db, projectId, lines) {
  const findAssignment = db.prepare('SELECT 1 FROM engineer_projects WHERE user_id = ? AND project_id = ?');
  const insertAssignment = db.prepare('INSERT INTO engineer_projects (user_id, project_id, pay_rate, bill_rate) VALUES (?, ?, ?, ?)');
  const engineerLines = lines.filter(l => l.engineer_id && !findAssignment.get(l.engineer_id, projectId));
  const firstLinePerEngineer = [...new Map(engineerLines.map(l => [Number(l.engineer_id), l])).values()];
  firstLinePerEngineer.forEach(l => insertAssignment.run(l.engineer_id, projectId, l.pay_per_unit || 0, l.edi_unit_price || 0));
  return firstLinePerEngineer.map(l => Number(l.engineer_id));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDollars(value) {
  return `$${(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Assignment-email bullets for an engineer's PO lines, with the total they can earn
function describeEngineerLinesHtml(lines) {
  const html = lines.map(l => {
    const units = l.edi_po_quantity || 0;
    const pay = l.pay_per_unit || 0;
    return `<li><strong>PO Line ${l.line_number}:</strong> ${escapeHtml(l.description)} — `
      + `${formatQuantity(units)} units × ${formatDollars(pay)}/unit = ${formatDollars(units * pay)}</li>`;
  }).join('');
  const total = lines.reduce((sum, l) => sum + (l.edi_po_quantity || 0) * (l.pay_per_unit || 0), 0);
  return { html, total: roundToCents(total) };
}

module.exports = {
  PoLineBillingError,
  escapeHtml,
  describeEngineerLinesHtml,
  migratePoLineBilling,
  hasPoLines,
  getPoLineStatus,
  getEngineerPoLines,
  resolveEngineerLine,
  priceEngineerUnits,
  buildPieceRateItem,
  mergePoLineItems,
  buildBilledLineItems,
  saveBilledLineItems,
  getBilledLineItems,
  getBilledLineQuantities,
  deleteBilledLineItems,
  getPieceRateInvoiceItems,
  assertLinesRemovable,
  ensureLineEngineersAssigned,
};
