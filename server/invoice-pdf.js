// Builds the customer invoice PDF (invoice page plus timesheet pages) used for emailing
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const vendorBilling = require('./vendor-billing');

const INVOICE_EMAIL_QUERY = `
SELECT i.*, p.name as project_name, p.description as project_description, p.po_number, p.location,
       p.include_timesheets, p.show_invoice_period,
       c.name as customer_name, c.address as customer_address, c.supplier_number, c.payment_terms,
       c.ap_email, c.email as customer_email, c.currency_symbol, c.send_invoice_to_self,
       cc.name as contact_name, cc.email as contact_email
FROM invoices i
JOIN projects p ON p.id = i.project_id
JOIN customers c ON c.id = p.customer_id
LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
WHERE i.id = ?
`;

const LOCAL_BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe',
];

const PDF_OPTIONS = { format: 'Letter', printBackground: true, margin: { top: '0.25in', right: '0.25in', bottom: '0.25in', left: '0.25in' } };

function getInvoiceForEmail(db, invoiceId) {
  return db.prepare(INVOICE_EMAIL_QUERY).get(invoiceId);
}

// Local development uses an installed Chrome/Edge; Render uses @sparticuz/chromium
async function launchPdfBrowser() {
  const isLocal = process.platform === 'win32' || !process.env.RENDER;
  if (isLocal) {
    const chromePath = LOCAL_BROWSER_PATHS.find(p => fs.existsSync(p));
    if (!chromePath) {
      throw new Error('No compatible browser found. Install Chrome or Edge for PDF generation.');
    }
    return puppeteer.launch({ executablePath: chromePath, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

async function renderPdf(browser, html, pdfOptions = PDF_OPTIONS) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf(pdfOptions);
  } finally {
    await page.close();
  }
}

function buildInvoiceFilename(invoice, formatDate) {
  const rawPo = invoice.po_number || 'N-A';
  const poNum = rawPo.replace(/^PO\s*/i, '').trim();
  const po = rawPo !== 'N-A' ? `PO ${poNum}` : 'N-A';
  let name = invoice.project_name || '';
  if (poNum && name.includes(poNum)) {
    const escaped = poNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    name = name.replace(new RegExp(`\\s*-?\\s*(?:PO\\s*)?${escaped}\\s*-?\\s*`), ' ').trim();
  }
  const fileDate = (dateStr) => formatDate(dateStr).replace(/\//g, '_');
  const parts = [po, `Inv ${invoice.invoice_number}`];
  if (name) parts.push(name);
  if (invoice.show_invoice_period !== 0) parts.push(`${fileDate(invoice.period_start)} to ${fileDate(invoice.period_end)}`);
  return parts.join(' - ') + '.pdf';
}

// Returns the invoice PDF HTML plus the values the email body needs
function buildInvoicePdf(db, invoice, settings) {
  // Get line items and timesheet details
  // Find timesheets that have entries stamped with this invoice ID
  const timesheets = db.prepare(`
    SELECT DISTINCT ts.*, u.name as engineer_name, u.engineer_id, ep.bill_rate, ep.monthly_bill, ep.monthly_pay, p.project_type
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    WHERE ts.project_id = ? AND ts.status = 'approved'
    AND (te.invoice_id = ? OR (p.project_type = 'fixed_price' AND ts.invoice_id = ?))
    ORDER BY u.name, ts.week_ending
  `).all(invoice.project_id, invoice.id, invoice.id);

  const lineItems = [];
  const timesheetDetails = [];
  const isFixedMonthly = timesheets.length > 0 && timesheets[0].project_type === 'fixed_monthly';
  for (const ts of timesheets) {
    const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? AND invoice_id = ? ORDER BY entry_date')
      .all(ts.id, invoice.id);
    const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
    if (hrs > 0) {
      if (isFixedMonthly) {
        const existing = lineItems.find(li => li.engineer === ts.engineer_name);
        if (existing) {
          existing.hours += hrs;
        } else {
          lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.monthly_bill || 0, amount: ts.monthly_bill || 0, is_fixed_monthly: true });
        }
      } else {
        lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.bill_rate || 0, amount: hrs * (ts.bill_rate || 0), week_ending: ts.week_ending });
      }
      timesheetDetails.push({
        engineer_name: ts.engineer_name,
        engineer_id: ts.engineer_id,
        week_ending: ts.week_ending,
        bill_rate: isFixedMonthly ? (ts.monthly_bill || 0) : ts.bill_rate,
        is_fixed_monthly: isFixedMonthly,
        total_hours: hrs,
        entries
      });
    }
  }

  const adjustments = db.prepare('SELECT * FROM invoice_adjustments WHERE invoice_id = ? ORDER BY id').all(invoice.id);
  adjustments.forEach(adj => {
    lineItems.push({ description: adj.description, hours: adj.hours || 0, rate: adj.rate || 0, amount: adj.amount, is_adjustment: true });
  });

  // Currency symbol for this customer
  const cs = invoice.currency_symbol || '$';

  // Helper functions
  const formatCurrency = (amt) => `${cs}${(amt || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const str = String(dateStr);
    const datePart = str.includes('T') ? str.split('T')[0] : str.split(' ')[0];
    const d = new Date(datePart + 'T00:00:00');
    if (isNaN(d.getTime())) return datePart;
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  };
  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${hour12}:${m} ${ampm}`;
  };

  // Calculate due date
  let daysUntilDue = 30;
  if (invoice.payment_terms === 'Immediate') {
    daysUntilDue = 0;
  } else {
    const match = invoice.payment_terms?.match(/Net\s*(\d+)/i);
    if (match) daysUntilDue = parseInt(match[1], 10);
  }
  const invoiceDate = new Date(String(invoice.created_at).replace(' ', 'T'));
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + daysUntilDue);
  const dueDateStr = isNaN(dueDate.getTime()) ? '' : dueDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  const invoiceDateStr = formatDate(invoice.created_at);
  const periodRange = `${formatDate(invoice.period_start)} to ${formatDate(invoice.period_end)}`;

  // Build invoice page HTML (matches print view)
  const weekRange = (weekEnding) => {
    if (!weekEnding) return periodRange;
    const end = new Date(weekEnding.split('T')[0] + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return `${formatDate(start.toISOString().split('T')[0])} to ${formatDate(end.toISOString().split('T')[0])}`;
  };

  const showPeriod = invoice.show_invoice_period !== 0;
  const withPeriod = (text, range) => (showPeriod ? `${text} - ${range}` : text);
  const hasHours = lineItems.some(item => item.hours > 0);
  const lineItemRows = lineItems.map(item => {
    const qty = item.hours > 0 ? item.hours.toFixed(2) : '1';
    const rate = item.rate > 0 ? `${cs}${item.rate.toFixed(2)}` : `${cs}${(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const desc = item.is_adjustment
      ? item.description
      : withPeriod(`${invoice.project_description || 'Engineering Labor Hours'} - ${item.engineer}`, weekRange(item.week_ending));
    return `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${qty}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.po_number || 'Engineering'}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${desc}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${rate}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;"></td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${cs}${(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  `;
  }).join('');
  const totalHoursRow = hasHours && lineItems.length > 1 ? `
    <tr style="border-top: 2px solid #000; font-weight: bold;">
      <td style="border: 1px solid #ccc; padding: 8px;">${lineItems.reduce((s, i) => s + (i.hours || 0), 0).toFixed(2)}</td>
      <td style="border: 1px solid #ccc; padding: 8px;" colspan="4">Total Hours</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${cs}${lineItems.reduce((s, i) => s + (i.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  ` : '';
  const lineItemsHtml = lineItems.length > 0 ? lineItemRows + totalHoursRow : `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.total_hours > 0 ? invoice.total_hours.toFixed(2) : '1'}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.po_number || 'Engineering'}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${withPeriod(invoice.project_description || 'Engineering Labor Hours', periodRange)}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${invoice.total_hours > 0 ? '—' : cs + (invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;"></td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">${cs}${(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  `;

  const invoicePageHtml = `
    <div style="font-family: Arial, sans-serif; color: #000; padding: 20px;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; margin-bottom: 24px;">
        <div style="line-height: 1.4;">
          <div style="font-weight: bold; font-size: 16px;">${settings.company_name || 'Your Company Name'}</div>
          ${settings.company_address ? `<div>${settings.company_address}</div>` : ''}
          ${settings.company_city_state_zip ? `<div>${settings.company_city_state_zip}</div>` : ''}
          ${settings.company_phone ? `<div>Phone: ${settings.company_phone}</div>` : ''}
          ${settings.company_fax ? `<div>Fax: ${settings.company_fax}</div>` : ''}
          ${settings.company_email ? `<div>E-mail: ${settings.company_email}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <div style="font-weight: bold; font-size: 18px; margin-bottom: 8px;">Invoice</div>
          <table style="margin-left: auto; border-collapse: collapse; font-size: 12px;">
            <tr><td style="padding: 2px 8px; text-align: left;">Invoice no:</td><td style="padding: 2px 8px; text-align: right; font-weight: bold;">${invoice.invoice_number}</td></tr>
            <tr><td style="padding: 2px 8px; text-align: left;">Invoice date:</td><td style="padding: 2px 8px; text-align: right;">${invoiceDateStr}</td></tr>
            <tr><td style="padding: 2px 8px; text-align: left;">Due date:</td><td style="padding: 2px 8px; text-align: right;">${dueDateStr}</td></tr>
            <tr><td style="padding: 2px 8px; text-align: left;">Supplier ID:</td><td style="padding: 2px 8px; text-align: right;">${invoice.supplier_number || '—'}</td></tr>
            <tr><td style="padding: 2px 8px; text-align: left;">PO Number:</td><td style="padding: 2px 8px; text-align: right; font-weight: bold;">${invoice.po_number || '—'}</td></tr>
          </table>
        </div>
      </div>

      <!-- Bill To and Logo -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
        <div>
          <div style="font-weight: bold; margin-bottom: 4px;">To:</div>
          <div style="line-height: 1.5; margin-left: 20px;">
            <div style="font-weight: bold;">${invoice.customer_name}</div>
            ${(invoice.customer_address || '').split('\n').map(line => `<div>${line}</div>`).join('')}
          </div>
        </div>
        ${settings.company_logo ? `<div style="text-align: right;"><img src="${settings.company_logo}" style="max-width: 200px; max-height: 80px;" /></div>` : ''}
      </div>

      <!-- Project Info -->
      <div style="margin-bottom: 16px; padding: 8px 12px; background: #f5f5f5; border-radius: 4px;">
        <strong>Project:</strong> ${invoice.project_name}
      </div>

      <!-- Sales Info -->
      <div style="display: flex; justify-content: space-between; margin-bottom: 16px; font-size: 12px; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 8px 0;">
        <div><strong>Sales Person:</strong> ${settings.company_name || '—'}</div>
        <div><strong>Contact name:</strong> ${invoice.contact_name || '—'}</div>
        <div><strong>Payment terms:</strong> ${invoice.payment_terms || 'Net 30'}</div>
      </div>

      <!-- Line Items Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <thead>
          <tr style="background: #f0f0f0;">
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Qty.</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Item</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Description</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: right;">Unit Price</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: right;">Discount</th>
            <th style="border: 1px solid #ccc; padding: 8px; text-align: right;">Line Total</th>
          </tr>
        </thead>
        <tbody>${lineItemsHtml}</tbody>
      </table>

      <!-- Totals -->
      <div style="display: flex; justify-content: flex-end;">
        <table style="border-collapse: collapse; min-width: 200px;">
          <tr><td style="padding: 4px 12px; text-align: right;">Subtotal</td><td style="padding: 4px 12px; text-align: right; font-weight: bold;">${cs}${(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding: 4px 12px; text-align: right;">Sales tax</td><td style="padding: 4px 12px; text-align: right;">${cs}0.00</td></tr>
          <tr style="border-top: 2px solid #000;"><td style="padding: 8px 12px; text-align: right; font-weight: bold; font-size: 14px;">Total</td><td style="padding: 8px 12px; text-align: right; font-weight: bold; font-size: 14px;">${cs}${(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
        </table>
      </div>
      ${vendorBilling.renderPrintNotesHtml(invoice.print_notes)}
    </div>
  `;

  // Build timesheet pages HTML (only if include_timesheets is set)
  let timesheetPagesHtml = '';
  if (invoice.include_timesheets && timesheetDetails.length > 0) {
    timesheetPagesHtml = timesheetDetails.map(ts => {
      const weekEnding = formatDate(ts.week_ending);
      const isFixedMonthlyTs = ts.is_fixed_monthly;
      const rate = isFixedMonthlyTs ? 0 : (ts.bill_rate || 0);
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      // Build entries by date map
      const entriesByDate = {};
      ts.entries.forEach(e => {
        const dateKey = e.entry_date ? e.entry_date.split('T')[0] : '';
        if (dateKey) entriesByDate[dateKey] = e;
      });

      // Calculate week dates, filtered to billing month
      const weekEnd = new Date(ts.week_ending + 'T00:00:00');
      const allWeekDates = [];
      for (let i = -6; i <= 0; i++) {
        const d = new Date(weekEnd);
        d.setDate(weekEnd.getDate() + i);
        allWeekDates.push(d.toISOString().split('T')[0]);
      }
      // Filter to only dates within the invoice period
      const weekDates = allWeekDates.filter(date => date >= invoice.period_start && date <= invoice.period_end);

      // Calculate totals
      let totalST = 0;
      weekDates.forEach(date => {
        const entry = entriesByDate[date];
        if (entry && entry.hours) totalST += entry.hours;
      });
      const laborSubtotal = isFixedMonthlyTs ? (ts.bill_rate || 0) : (totalST * rate);

      // Build rows
      const rowsHtml = weekDates.map((date) => {
        const entry = entriesByDate[date] || {};
        const dateObj = new Date(date + 'T00:00:00');
        const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
        const hours = entry.hours || 0;
        const st = hours > 0 ? hours.toFixed(2) : '0.00';

        return `
          <tr>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${formattedDate} ${dayName}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${invoice.location || ''}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;"></td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${entry.shift || '1'}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;"></td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${formatTime(entry.start_time)}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${formatTime(entry.end_time)}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${st}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.00</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.00</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.00</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.00</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">${st}</td>
          </tr>
          <tr>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; height: 45px; vertical-align: top;"><strong>Description:</strong></td>
            <td colspan="12" style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; height: 45px; vertical-align: top;">${entry.description || ''}</td>
          </tr>
        `;
      }).join('');

      return `
        <div style="page-break-before: always; font-family: Arial, sans-serif; font-size: 6pt; padding: 10px;">
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <div style="width: 160px;">
              ${settings.company_logo ? `<img src="${settings.company_logo}" style="max-width: 80px; max-height: 30px; margin-bottom: 1px;" />` : ''}
              <div style="font-weight: bold; font-style: italic; font-size: 7pt;">${settings.company_name || 'Company Name'}</div>
              <div style="font-size: 5pt;">Service at: <strong>${invoice.customer_name}</strong></div>
              <div style="font-size: 5pt;">Location: ${invoice.location || ''}</div>
            </div>
            <div style="width: 160px; text-align: center;">
              <div style="font-weight: bold; font-size: 9pt; margin-bottom: 1px;">Daily Time Report</div>
              <div style="font-size: 5pt;">Mon shift 1 - Sun shift 3<br/>${isFixedMonthlyTs ? 'Fixed Monthly' : `${cs}${rate.toFixed(2)}/hr`} | ST = All | OT/PT = N/A</div>
            </div>
            <div style="width: 180px; font-size: 5pt; line-height: 1.1;">
              <div><span style="display: inline-block; width: 55px; text-align: right; padding-right: 2px;">Week Ending:</span><strong>${weekEnding}</strong></div>
              <div><span style="display: inline-block; width: 55px; text-align: right; padding-right: 2px;">Engineer:</span>${ts.engineer_name}</div>
              <div><span style="display: inline-block; width: 55px; text-align: right; padding-right: 2px;">Engineer ID:</span>${ts.engineer_id || ''}</div>
              <div><span style="display: inline-block; width: 55px; text-align: right; padding-right: 2px;">Work Order #:</span>${invoice.po_number || ''}</div>
              <div><span style="display: inline-block; width: 55px; text-align: right; padding-right: 2px;">Project:</span>${invoice.project_name}</div>
            </div>
          </div>

          <!-- Time Table -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px;">
            <thead>
              <tr>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 55px;">Date</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 50px;">Travel To</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 55px;">Travel From</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 30px;">Shift</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 40px;">On Call</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 50px;">Start Time</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 50px;">End Time</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 28px;">ST</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 28px;">OT</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 28px;">PT</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 28px;">STT</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 28px;">OTT</th>
                <th style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; background: #f5f5f5; width: 35px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr style="background: #f5f5f5;">
                <td colspan="7" style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; font-weight: bold;">Weekly Totals:</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">${totalST.toFixed(2)}</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.00</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.00</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.00</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.00</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">${totalST.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <!-- Signatures and Expenses -->
          <div style="display: flex; justify-content: space-between; font-size: 5pt; margin-top: 2px;">
            <div style="width: 48%;">
              <div style="margin-bottom: 2px;">
                <div style="border-bottom: 1px solid #000; height: 10px; margin-bottom: 1px;"></div>
                <div>Certified by: <span style="margin-left: 20px;">Date: _______</span></div>
                <div style="font-size: 4pt;">${settings.company_name || 'Company'} Site Lead</div>
              </div>
              <div>
                <div style="border-bottom: 1px solid #000; height: 10px; margin-bottom: 1px;"></div>
                <div>Approved by: <span style="margin-left: 20px;">Date: _______</span></div>
                <div style="font-size: 4pt;">Customer Representative</div>
              </div>
            </div>
            <div style="width: 50%; border: 1px solid #000;">
              <div style="background: #f5f5f5; text-align: center; font-weight: bold; border-bottom: 1px solid #000; padding: 0 1px; font-size: 5pt;">Expenses</div>
              <div style="padding: 0 2px; font-size: 5pt;">Air: ${cs}0 | Car: ${cs}0 | Meals: ${cs}0 | Parking: ${cs}0 | Misc: ${cs}0</div>
              <div style="text-align: right; padding: 0 2px; font-size: 5pt;"><strong>Exp Subtotal:</strong> ${cs}0.00</div>
              <div style="text-align: right; padding: 0 2px; font-size: 5pt;">${isFixedMonthlyTs ? `Fixed Monthly | Hours: ${totalST.toFixed(2)}` : `Rate: ${cs}${rate.toFixed(2)}/hr | Hours: ${totalST.toFixed(2)}`}</div>
              <div style="text-align: right; padding: 1px 2px; font-weight: bold; font-size: 6pt;">Total: ${cs}${laborSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Full PDF HTML
  const pdfHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page { margin: 0.25in; size: letter; }
        body { margin: 0; padding: 0; }
      </style>
    </head>
    <body>
      ${invoicePageHtml}
      ${timesheetPagesHtml}
    </body>
    </html>
  `;

  return { html: pdfHtml, dueDateStr, formatCurrency, filename: buildInvoiceFilename(invoice, formatDate) };
}

module.exports = { getInvoiceForEmail, launchPdfBrowser, renderPdf, buildInvoicePdf };
