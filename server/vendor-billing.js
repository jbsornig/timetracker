// Subcontracted work on fixed-price projects: a paid vendor PO linked to the project is billed to the
// customer as the same share of the project's contract value (e.g. vendor PO 100% paid -> bill 100%).

function selectVendorPayments(db, whereSql, params) {
  return db.prepare(`
    SELECT pay.id, pay.amount, pay.payment_date, pay.invoice_id,
           po.id as purchase_order_id, po.po_number, po.total_amount as po_total, po.invoice_notes,
           v.name as vendor_name
    FROM po_payments pay
    JOIN purchase_orders po ON po.id = pay.purchase_order_id
    LEFT JOIN vendors v ON v.id = po.vendor_id
    WHERE ${whereSql}
    ORDER BY pay.payment_date, pay.id
  `).all(...params);
}

function getUnbilledVendorPayments(db, projectId, periodStart, periodEnd) {
  return selectVendorPayments(
    db,
    'po.project_id = ? AND pay.invoice_id IS NULL AND DATE(pay.payment_date) BETWEEN ? AND ?',
    [projectId, periodStart, periodEnd]
  );
}

function getInvoiceVendorPayments(db, invoiceId) {
  return selectVendorPayments(db, 'pay.invoice_id = ?', [invoiceId]);
}

// One line per vendor PO: (amount paid / PO total) x the project's total cost
function buildVendorLineItems(payments, projectTotalCost) {
  const byPo = new Map();
  for (const payment of payments) {
    const existing = byPo.get(payment.purchase_order_id);
    byPo.set(payment.purchase_order_id, existing
      ? { ...existing, paid: existing.paid + (payment.amount || 0) }
      : { ...payment, paid: payment.amount || 0 });
  }
  return [...byPo.values()]
    .filter(po => po.po_total > 0)
    .map(po => {
      const share = po.paid / po.po_total;
      return {
        engineer: '',
        percentage: Math.round(share * 10000) / 100,
        engineer_amount: po.paid,
        amount: share * (projectTotalCost || 0),
        vendor_po_number: po.po_number,
        vendor_name: po.vendor_name,
        is_fixed_price: true,
        is_vendor: true,
      };
    });
}

function collectInvoiceNotes(payments) {
  const notesByPo = new Map();
  for (const payment of payments) {
    const text = (payment.invoice_notes || '').trim();
    if (text && !notesByPo.has(payment.purchase_order_id)) notesByPo.set(payment.purchase_order_id, text);
  }
  return [...notesByPo.values()].join('\n\n');
}

function renderPrintNotesHtml(printNotes) {
  const text = (printNotes || '').trim();
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/\n/g, '<br/>');
  return `<div style="margin-top: 16px; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; line-height: 1.5;"><strong>Notes:</strong><br/>${escaped}</div>`;
}

function stampVendorPayments(db, payments, invoiceId) {
  const stamp = db.prepare('UPDATE po_payments SET invoice_id = ? WHERE id = ?');
  for (const payment of payments) stamp.run(invoiceId, payment.id);
}

function releaseVendorPayments(db, invoiceId) {
  db.prepare('UPDATE po_payments SET invoice_id = NULL WHERE invoice_id = ?').run(invoiceId);
}

module.exports = {
  getUnbilledVendorPayments,
  getInvoiceVendorPayments,
  buildVendorLineItems,
  collectInvoiceNotes,
  renderPrintNotesHtml,
  stampVendorPayments,
  releaseVendorPayments,
};
