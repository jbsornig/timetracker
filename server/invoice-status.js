// Keeps an invoice's status and paid date in step with its total and amount paid.
// Used when the total changes after payments were recorded (adjustments, credits).

const CENT_TOLERANCE = 0.005;

function getLastPaymentDate(db, invoiceId) {
  const row = db.prepare('SELECT MAX(payment_date) AS last_date FROM payments WHERE invoice_id = ?').get(invoiceId);
  return row?.last_date || null;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function refreshInvoiceStatus(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice || invoice.status === 'voided' || invoice.voided_date) return invoice;

  const total = invoice.total_amount || 0;
  const paid = invoice.amount_paid || 0;
  const isPaid = paid > 0 && paid >= total - CENT_TOLERANCE;

  let status = 'unpaid';
  let paidDate = null;
  if (isPaid) {
    status = 'paid';
    paidDate = invoice.paid_date || getLastPaymentDate(db, invoiceId) || getToday();
  } else if (paid > 0) {
    status = 'partial';
  }

  db.prepare('UPDATE invoices SET status = ?, paid_date = ? WHERE id = ?').run(status, paidDate, invoiceId);
  return { ...invoice, status, paid_date: paidDate };
}

module.exports = { refreshInvoiceStatus };
