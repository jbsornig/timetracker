// "Classic" invoice page: the layout of the invoices sent before TimeTracker (2024), which
// some customers' invoice-capture systems (Mercedes-Benz España's Basware) read reliably.
// It fills exactly one Letter page; timesheet pages follow it unchanged.
const { escapeHtml } = require('./po-line-billing');

const INVOICE_LAYOUTS = ['standard', 'classic'];

const CLASSIC_STYLES = `
  .classic-invoice { font-family: Tahoma, Verdana, Arial, sans-serif; font-size: 8pt; color: #000; box-sizing: border-box;
    height: 10.45in; padding: 0.25in 0.1in 0.1in; display: flex; flex-direction: column; }
  .classic-invoice .ci-header { display: flex; padding-left: 1.1in; }
  .classic-invoice .ci-header > div { flex: 1; }
  .classic-invoice h1 { font-family: Arial, sans-serif; font-size: 16pt; font-weight: bold; margin: 0 0 10px 0; }
  .classic-invoice .ci-fields { border-collapse: collapse; }
  .classic-invoice .ci-fields td { padding: 0 8px 2px 0; vertical-align: top; }
  .classic-invoice .ci-invoice .ci-fields td.ci-label { width: 1.6in; font-weight: bold; }
  .classic-invoice hr { border: 0; border-top: 1px solid #ccc; margin: 20px 0 22px 0; width: 100%; }
  .classic-invoice .ci-to { padding-left: 1.1in; min-height: 1.45in; }
  .classic-invoice .ci-to .ci-label { font-weight: bold; margin-bottom: 8px; }
  .classic-invoice .ci-to div { line-height: 1.3; }
  .classic-invoice .ci-grid { width: 100%; border-collapse: collapse; margin-bottom: 0.5in; }
  .classic-invoice .ci-grid td { border: 1px solid #ccc; padding: 3px 6px; width: 25%; }
  .classic-invoice .ci-grid td.ci-key { font-weight: bold; }
  .classic-invoice .ci-items-area { flex: 1 1 auto; min-height: 0; display: flex; }
  .classic-invoice .ci-items { width: 100%; height: 100%; border-collapse: collapse; }
  .classic-invoice .ci-items th { background: #000; color: #fff; text-align: left; padding: 6px; font-weight: bold; height: 14px; }
  .classic-invoice .ci-items td { border-left: 1px solid #ccc; border-right: 1px solid #ccc; padding: 6px; vertical-align: top; height: 1px; }
  .classic-invoice .ci-items tr.ci-filler td { height: auto; border-bottom: 1px solid #ccc; }
  .classic-invoice .ci-num { text-align: right; }
  .classic-invoice .ci-notes { margin-top: 8px; }
  .classic-invoice .ci-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 12px; }
  .classic-invoice .ci-totals td { padding: 1px 0 1px 30px; font-weight: bold; }
  .classic-invoice .ci-totals td.ci-value { font-weight: normal; text-align: right; }
`;

function normalizeInvoiceLayout(value) {
  return INVOICE_LAYOUTS.includes(value) ? value : 'standard';
}

function fieldRow(label, value) {
  return `<tr><td class="ci-label">${label}</td><td>${escapeHtml(value)}</td></tr>`;
}

function renderCompanyBlock(settings) {
  const contactRows = [
    settings.company_phone && ['Phone:', settings.company_phone],
    settings.company_fax && ['Fax:', settings.company_fax],
    settings.company_email && ['E-mail:', settings.company_email],
  ].filter(Boolean);
  return `
    <div>
      <h1>${escapeHtml(settings.company_name || 'Your Company Name')}</h1>
      <table class="ci-fields">
        ${settings.company_address ? `<tr><td colspan="2">${escapeHtml(settings.company_address)}</td></tr>` : ''}
        ${settings.company_city_state_zip ? `<tr><td colspan="2">${escapeHtml(settings.company_city_state_zip)}</td></tr>` : ''}
        ${contactRows.map(([label, value]) => fieldRow(label, value)).join('')}
      </table>
    </div>`;
}

function renderInvoiceFields(invoice, invoiceDateStr, dueDateStr) {
  const rows = [
    ['Invoice no:', invoice.invoice_number],
    ['Invoice date:', invoiceDateStr],
    ['Due date:', dueDateStr],
    invoice.supplier_number && ['Supplier no:', invoice.supplier_number],
    ['Job name:', invoice.po_number || invoice.project_name || ''],
  ].filter(Boolean);
  return `
    <div class="ci-invoice">
      <h1>Invoice</h1>
      <table class="ci-fields">${rows.map(([label, value]) => fieldRow(label, value)).join('')}</table>
    </div>`;
}

function renderRecipient(invoice) {
  const addressLines = String(invoice.customer_address || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return `
    <div class="ci-to">
      <div class="ci-label">To:</div>
      ${[invoice.customer_name, ...addressLines].filter(Boolean).map(line => `<div>${escapeHtml(line)}</div>`).join('')}
    </div>`;
}

// rows: [{ qty, item, description, unitPrice, lineTotal }]; description may hold pre-escaped HTML
function renderItems(rows) {
  const rowHtml = rows.map(row => `
    <tr>
      <td class="ci-num">${escapeHtml(row.qty)}</td>
      <td>${escapeHtml(row.item)}</td>
      <td>${row.description}</td>
      <td class="ci-num">${escapeHtml(row.unitPrice)}</td>
      <td></td>
      <td class="ci-num">${escapeHtml(row.lineTotal)}</td>
    </tr>`).join('');
  return `
    <div class="ci-items-area">
      <table class="ci-items">
        <tr><th style="width:6%">Qty.</th><th style="width:13%">Item</th><th style="width:28%">Description</th><th style="width:13%">Unit Price</th><th style="width:12%">Discount</th><th>Line Total</th></tr>
        ${rowHtml}
        <tr class="ci-filler"><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>
    </div>`;
}

function renderClassicInvoicePageHtml({ invoice, settings, rows, invoiceDateStr, dueDateStr, formatCurrency, notesHtml = '' }) {
  const total = formatCurrency(invoice.total_amount || 0);
  return `
    <style>${CLASSIC_STYLES}</style>
    <div class="classic-invoice">
      <div class="ci-header">
        ${renderCompanyBlock(settings)}
        ${renderInvoiceFields(invoice, invoiceDateStr, dueDateStr)}
      </div>
      <hr>
      ${renderRecipient(invoice)}
      <table class="ci-grid">
        <tr><td class="ci-key">Sales Person</td><td>${escapeHtml(settings.invoice_sales_person || settings.company_name || '')}</td>
            <td class="ci-key">Contact name</td><td>${escapeHtml(invoice.contact_name || '')}</td></tr>
        <tr><td class="ci-key">Delivery date</td><td></td>
            <td class="ci-key">Payment terms</td><td>${escapeHtml(invoice.payment_terms || 'Net 30')}</td></tr>
      </table>
      ${renderItems(rows)}
      ${notesHtml ? `<div class="ci-notes">${notesHtml}</div>` : ''}
      <div class="ci-footer">
        <div>Page 1/1</div>
        <table class="ci-totals">
          <tr><td>Subtotal</td><td class="ci-value">${escapeHtml(total)}</td></tr>
          <tr><td>Sales tax</td><td class="ci-value">${escapeHtml(formatCurrency(0))}</td></tr>
          <tr><td>Total</td><td class="ci-value">${escapeHtml(total)}</td></tr>
        </table>
      </div>
    </div>`;
}

module.exports = { INVOICE_LAYOUTS, normalizeInvoiceLayout, renderClassicInvoicePageHtml };
