// Past-due statements: a customer-facing list of late invoices, emailed with copies of each invoice

const DEFAULT_NET_DAYS = 30;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const AGING_BUCKETS = ['1-30', '31-60', '61-90', '90+'];
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const MAX_NOTE_LENGTH = 2000;

const STATEMENT_PDF_OPTIONS = { format: 'Letter', printBackground: true, margin: { top: '0.5in', right: '0.6in', bottom: '0.5in', left: '0.6in' } };

function getNetDays(paymentTerms) {
  const terms = paymentTerms || 'Net 30';
  if (terms === 'Immediate') return 0;
  const match = terms.match(/Net\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : DEFAULT_NET_DAYS;
}

function getAgingBucket(daysOverdue) {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

// Due date is the invoice date plus the customer's net terms; the same rule the Overdue Invoices report uses
function withAging(invoice, today) {
  const created = new Date(String(invoice.created_at).replace(' ', 'T'));
  const dueDate = new Date(created);
  dueDate.setDate(dueDate.getDate() + getNetDays(invoice.payment_terms));
  dueDate.setHours(0, 0, 0, 0);
  const daysOverdue = Math.floor((today - dueDate) / MS_PER_DAY);
  return {
    ...invoice,
    due_date: dueDate.toISOString().split('T')[0],
    days_overdue: daysOverdue,
    balance: (invoice.total_amount || 0) - (invoice.amount_paid || 0),
    aging: getAgingBucket(daysOverdue),
  };
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getOpenInvoicesWithAging(db) {
  const invoices = db.prepare(`
    SELECT i.*, p.name as project_name, p.po_number,
           c.id as customer_id, c.name as customer_name, c.payment_terms
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE i.status IN ('unpaid', 'partial') AND i.voided_date IS NULL
    ORDER BY i.created_at
  `).all();
  const today = startOfToday();
  return invoices.map(invoice => withAging(invoice, today));
}

function getPastDueInvoices(db, customerId) {
  return getOpenInvoicesWithAging(db)
    .filter(invoice => invoice.customer_id === customerId && invoice.days_overdue > 0 && invoice.balance > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue);
}

function summarizeAging(invoices) {
  const totals = Object.fromEntries(AGING_BUCKETS.map(bucket => [bucket, 0]));
  for (const invoice of invoices) totals[invoice.aging] += invoice.balance;
  return totals;
}

function parseEmailList(value) {
  return String(value || '').split(/[,;]/).map(email => email.trim()).filter(Boolean);
}

function findInvalidEmails(emails) {
  return emails.filter(email => !EMAIL_PATTERN.test(email));
}

// The people who already receive this customer's invoices: AP first, then project contacts
function getDefaultRecipients(db, customer, invoices, settings) {
  const contactEmails = invoices.length === 0 ? [] : db.prepare(`
    SELECT DISTINCT cc.email
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customer_contacts cc ON cc.id = p.contact_id
    WHERE i.id IN (${invoices.map(() => '?').join(',')}) AND cc.email IS NOT NULL AND cc.email != ''
  `).all(...invoices.map(invoice => invoice.id)).map(row => row.email.trim());

  const to = customer.ap_email || customer.email || contactEmails[0] || '';
  const cc = [...new Set([...contactEmails, settings.admin_notification_email || ''])]
    .filter(email => email && email.toLowerCase() !== to.toLowerCase());
  return { to, cc };
}

function getLastStatementSends(db) {
  return db.prepare(`
    SELECT s.customer_id, s.sent_at, s.recipient, s.invoice_count, s.total_past_due
    FROM past_due_statements s
    WHERE s.id = (SELECT MAX(id) FROM past_due_statements WHERE customer_id = s.customer_id)
  `).all();
}

function recordStatementSend(db, { customerId, recipient, cc, invoices, totalPastDue, note }) {
  db.prepare(`
    INSERT INTO past_due_statements (customer_id, sent_at, recipient, cc, invoice_ids, invoice_count, total_past_due, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customerId, new Date().toISOString(), recipient, cc.join(', '),
    JSON.stringify(invoices.map(invoice => invoice.id)), invoices.length, totalPastDue, note || null
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function createFormatters(currencySymbol) {
  const symbol = currencySymbol || '$';
  const formatCurrency = amount => `${symbol}${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatDate = value => {
    if (!value) return '';
    const datePart = String(value).split(/[T ]/)[0];
    const date = new Date(datePart + 'T00:00:00');
    return isNaN(date.getTime()) ? datePart : date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  };
  return { formatCurrency, formatDate };
}

function formatLongDate(date) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function buildCompanyBlock(settings) {
  const lines = [
    settings.company_address,
    settings.company_city_state_zip,
    settings.company_phone ? `Phone: ${settings.company_phone}` : '',
    settings.company_email,
  ].filter(Boolean).map(line => `<div>${escapeHtml(line)}</div>`).join('');
  return `<div style="font-weight: bold; font-size: 16px;">${escapeHtml(settings.company_name || '')}</div>${lines}`;
}

// Project names often start with the PO number, which already has its own column
function stripPoFromProjectName(projectName, poNumber) {
  const name = projectName || '';
  const poDigits = String(poNumber || '').replace(/^PO\s*/i, '').trim();
  if (!poDigits) return name;
  const escaped = poDigits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return name.replace(new RegExp(`^\\s*(?:PO\\s*)?${escaped}\\s*-?\\s*`, 'i'), '').trim() || name;
}

function buildInvoiceRows(invoices, { formatCurrency, formatDate }) {
  return invoices.map(invoice => `
    <tr>
      <td>${escapeHtml(invoice.invoice_number)}</td>
      <td style="white-space: nowrap;">${escapeHtml(invoice.po_number || '')}</td>
      <td>${escapeHtml(stripPoFromProjectName(invoice.project_name, invoice.po_number))}</td>
      <td class="center">${formatDate(invoice.created_at)}</td>
      <td class="center">${formatDate(invoice.due_date)}</td>
      <td class="center late">${invoice.days_overdue}</td>
      <td class="num">${formatCurrency(invoice.total_amount)}</td>
      <td class="num">${formatCurrency(invoice.amount_paid)}</td>
      <td class="num strong">${formatCurrency(invoice.balance)}</td>
    </tr>`).join('');
}

function buildAgingTable(aging, totalPastDue, formatCurrency) {
  const headers = AGING_BUCKETS.map(bucket => `<th>${bucket} days</th>`).join('');
  const cells = AGING_BUCKETS.map(bucket => `<td>${formatCurrency(aging[bucket])}</td>`).join('');
  return `
    <table class="aging">
      <thead><tr>${headers}<th>Total Past Due</th></tr></thead>
      <tbody><tr>${cells}<td class="strong">${formatCurrency(totalPastDue)}</td></tr></tbody>
    </table>`;
}

function buildNoteHtml(note) {
  const text = (note || '').trim();
  if (!text) return '';
  return `<div class="note">${escapeHtml(text).replace(/\n/g, '<br/>')}</div>`;
}

function buildStatementHtml({ customer, invoices, settings, note, statementDate = new Date() }) {
  const formatters = createFormatters(customer.currency_symbol);
  const { formatCurrency } = formatters;
  const totalPastDue = invoices.reduce((sum, invoice) => sum + invoice.balance, 0);
  const aging = summarizeAging(invoices);
  const contactEmail = settings.company_email || settings.smtp_email || '';
  const logo = settings.company_logo
    ? `<img src="${escapeHtml(settings.company_logo)}" alt="" style="max-width: 200px; max-height: 80px;" />`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #000; font-size: 12px; line-height: 1.4; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .title { font-size: 22px; font-weight: bold; letter-spacing: 1px; margin: 0 0 4px; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 16px; }
    .label { font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; text-align: left; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; }
    .center { text-align: center; }
    .num { text-align: right; white-space: nowrap; }
    .strong { font-weight: bold; }
    .late { color: #b91c1c; font-weight: bold; }
    .total-row td { border-top: 2px solid #000; font-weight: bold; }
    .aging { margin-top: 16px; }
    .aging th, .aging td { text-align: center; }
    .note { margin-top: 16px; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; }
    tr { page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="header">
    <div>${buildCompanyBlock(settings)}</div>
    <div>${logo}</div>
  </div>
  <div class="title">PAST DUE STATEMENT</div>
  <div style="margin-bottom: 16px;">Statement date: ${formatLongDate(statementDate)}</div>
  <div class="meta">
    <div>
      <div class="label">Bill To</div>
      <div class="strong">${escapeHtml(customer.name)}</div>
      ${customer.address ? `<div>${escapeHtml(customer.address).replace(/\n/g, '<br/>')}</div>` : ''}
      ${customer.supplier_number ? `<div>Supplier #: ${escapeHtml(customer.supplier_number)}</div>` : ''}
    </div>
    <div style="text-align: right;">
      <div class="label">Total Past Due</div>
      <div style="font-size: 20px; font-weight: bold;">${formatCurrency(totalPastDue)}</div>
      <div>${invoices.length} invoice${invoices.length === 1 ? '' : 's'}</div>
    </div>
  </div>
  <p>Our records show the following invoices are past due. Copies of each invoice are attached for your reference.
  If payment has already been sent, please accept our thanks and disregard this notice.</p>
  <table>
    <thead>
      <tr>
        <th>Invoice #</th><th>PO</th><th>Project</th><th class="center">Invoice Date</th><th class="center">Due Date</th>
        <th class="center">Days Late</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${buildInvoiceRows(invoices, formatters)}
      <tr class="total-row">
        <td colspan="8">Total Past Due</td>
        <td class="num">${formatCurrency(totalPastDue)}</td>
      </tr>
    </tbody>
  </table>
  ${buildAgingTable(aging, totalPastDue, formatCurrency)}
  ${buildNoteHtml(note)}
  <p style="margin-top: 16px;">Payment terms: ${escapeHtml(customer.payment_terms || 'Net 30')}.
  ${contactEmail ? `Questions about this statement can be sent to ${escapeHtml(contactEmail)}.` : ''}</p>
  <p>Thank you for your business.</p>
</body>
</html>`;
}

function buildStatementEmailHtml({ customer, invoices, settings, note }) {
  const { formatCurrency, formatDate } = createFormatters(customer.currency_symbol);
  const totalPastDue = invoices.reduce((sum, invoice) => sum + invoice.balance, 0);
  const items = invoices.map(invoice =>
    `<li>Invoice #${escapeHtml(invoice.invoice_number)}: ${formatCurrency(invoice.balance)} (due ${formatDate(invoice.due_date)}, ${invoice.days_overdue} days late)</li>`
  ).join('');
  const contactEmail = settings.company_email || settings.smtp_email || '';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <p>Our records show ${invoices.length} past due invoice${invoices.length === 1 ? '' : 's'} totaling <strong>${formatCurrency(totalPastDue)}</strong> for ${escapeHtml(customer.name)}.</p>
      <ul>${items}</ul>
      ${note && note.trim() ? `<p>${escapeHtml(note.trim()).replace(/\n/g, '<br/>')}</p>` : ''}
      <p>The attached statement lists each invoice${invoices.length ? ', and a copy of each invoice is attached' : ''}. If payment has already been sent, thank you, and please disregard this notice.</p>
      <p>If you have any questions, please contact us at ${escapeHtml(contactEmail)}.</p>
      <p style="color: #666; font-size: 12px;">${escapeHtml(settings.company_name || '')}</p>
    </div>`;
}

function buildStatementFilename(customer, statementDate = new Date()) {
  const datePart = statementDate.toISOString().split('T')[0];
  const safeName = String(customer.name || 'Customer').replace(/[\\/:*?"<>|]/g, '').trim();
  return `Past Due Statement - ${safeName} - ${datePart}.pdf`;
}

module.exports = {
  MAX_NOTE_LENGTH,
  STATEMENT_PDF_OPTIONS,
  getOpenInvoicesWithAging,
  getPastDueInvoices,
  summarizeAging,
  parseEmailList,
  findInvalidEmails,
  getDefaultRecipients,
  getLastStatementSends,
  recordStatementSend,
  buildStatementHtml,
  buildStatementEmailHtml,
  buildStatementFilename,
};
