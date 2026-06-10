#!/usr/bin/env node
const readline = require('readline');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadCredentials, saveCredentials, hasCredentials } = require('./credential-store');
const { submitToESupplier } = require('./esupplier-automation');

const API_BASE = 'https://timetracker.utechconsulting.net';
const PDF_OUTPUT_DIR = path.join(require('os').homedir(), 'Documents', 'FCA_Invoices');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    let input = '';
    const onData = (char) => {
      const c = char.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (c === '') {
        process.exit();
      } else if (c === '' || c === '\b') {
        input = input.slice(0, -1);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + '*'.repeat(input.length));
      } else {
        input += c;
        process.stdout.write('*');
      }
    };
    stdin.resume();
    stdin.on('data', onData);
  });
}

function apiFetch(endpoint, token, options = {}) {
  const url = new URL(endpoint, API_BASE);
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers,
    };

    const req = mod.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.error || `HTTP ${res.statusCode}`));
          else resolve(json);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function login() {
  console.log('\n--- TimeTracker Login ---');
  const email = await ask('Email: ');
  const password = await askHidden('Password: ');
  const result = await apiFetch('/api/login', null, {
    method: 'POST',
    body: { email, password },
  });
  return result.token;
}

async function generateInvoicePdf(invoice, apiLineItems, settings, outputPath) {
  const puppeteer = require('puppeteer-core');

  const formatCurrency = (amt) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amt || 0);
  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US') : '';

  const lineItems = (apiLineItems || []).map(li => {
    if (li.is_fixed_monthly) {
      return { description: `${li.engineer} - Monthly Rate`, hours: li.hours ? li.hours.toFixed(2) : '', rate: '', amount: formatCurrency(li.amount) };
    } else if (li.is_fixed_price) {
      return { description: `${li.engineer} - ${li.percentage || 0}%`, hours: '', rate: '', amount: formatCurrency(li.amount) };
    }
    return { description: li.engineer, hours: (li.hours || 0).toFixed(2), rate: formatCurrency(li.rate), amount: formatCurrency(li.amount) };
  });

  const invoiceHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
        <div>
          <h2 style="margin:0;">${settings.company_name || 'Unlimited Technologies Consulting'}</h2>
          <p style="margin:5px 0; font-size:12px;">${settings.company_address || '4048 Heron Drive, Lapeer, MI 48446'}</p>
        </div>
        <div style="text-align: right;">
          <h1 style="margin:0; color:#1e40af;">INVOICE</h1>
          <p style="margin:5px 0;">Invoice #: ${invoice.invoice_number}</p>
          <p style="margin:5px 0;">Date: ${formatDate(invoice.period_end)}</p>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
        <div>
          <strong>Bill To:</strong><br/>
          ${invoice.customer_name}<br/>
          ${invoice.customer_address || ''}
        </div>
        <div style="text-align: right;">
          <strong>PO Number:</strong> ${invoice.po_number || 'N/A'}<br/>
          <strong>Project:</strong> ${invoice.project_name}<br/>
          <strong>Period:</strong> ${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: #1e40af; color: white;">
            <th style="padding: 8px; text-align: left;">Description</th>
            <th style="padding: 8px; text-align: right;">Hours</th>
            <th style="padding: 8px; text-align: right;">Rate</th>
            <th style="padding: 8px; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lineItems.map(li => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 8px;">${li.description}</td>
              <td style="padding: 8px; text-align: right;">${li.hours}</td>
              <td style="padding: 8px; text-align: right;">${li.rate}</td>
              <td style="padding: 8px; text-align: right;">${li.amount}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="text-align: right; font-size: 18px; font-weight: bold;">
        Total: ${formatCurrency(invoice.total_amount)}
      </div>
      <div style="margin-top: 30px; font-size: 12px; color: #666;">
        Payment Terms: ${invoice.payment_terms || 'Net 30'}
      </div>
    </div>
  `;

  const pdfHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>@page { margin: 0.25in; size: letter; } body { margin: 0; padding: 0; }</style></head><body>${invoiceHtml}</body></html>`;

  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromePath = possiblePaths.find(p => fs.existsSync(p));
  if (!chromePath) throw new Error('No compatible browser found. Install Chrome or Edge for PDF generation.');

  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.25in', right: '0.25in', bottom: '0.25in', left: '0.25in' } });
  await browser.close();

  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`  PDF saved: ${outputPath}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   eSupplierConnect Invoice Submission    ║');
  console.log('╚══════════════════════════════════════════╝');

  // Step 1: Get eSupplier credentials
  console.log('\n[1/5] Loading eSupplier credentials...');
  let esupplierCreds;
  if (!hasCredentials()) {
    console.log('  No saved credentials found. Let\'s set them up.');
    const username = await ask('  eSupplierConnect Username: ');
    const password = await askHidden('  eSupplierConnect Password: ');
    const passphrase = await askHidden('  Choose encryption passphrase: ');
    saveCredentials({ username, password }, passphrase);
    esupplierCreds = { username, password };
    console.log('  Credentials saved (encrypted).');
  } else {
    const passphrase = await askHidden('  Enter passphrase to decrypt eSupplier credentials: ');
    try {
      esupplierCreds = loadCredentials(passphrase);
      console.log('  Credentials loaded.');
    } catch (e) {
      console.error('  ERROR: Invalid passphrase.');
      process.exit(1);
    }
  }

  // Step 2: Login to TimeTracker production
  console.log('\n[2/5] Authenticating with TimeTracker...');
  let token;
  try {
    token = await login();
    console.log('  Logged in successfully.');
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
    process.exit(1);
  }

  // Step 3: Select invoice
  console.log('\n[3/5] Fetching invoices...');
  const invoices = await apiFetch('/api/invoices', token);
  const stellantisInvoices = invoices.filter(i => i.supplier_number === '38850' && i.po_number && i.status !== 'voided');

  if (stellantisInvoices.length === 0) {
    console.log('  No Stellantis/FCA invoices found.');
    process.exit(0);
  }

  console.log('\n  Stellantis/FCA Invoices:');
  console.log('  ─────────────────────────────────────────────────────────────────');
  stellantisInvoices.slice(0, 20).forEach((inv, i) => {
    const status = inv.status === 'paid' ? ' [PAID]' : inv.status === 'partial' ? ' [PARTIAL]' : '';
    console.log(`  ${String(i + 1).padStart(3)}. #${inv.invoice_number.padEnd(8)} ${inv.project_name.slice(0, 25).padEnd(25)} PO: ${inv.po_number.padEnd(12)} $${inv.total_amount.toFixed(2).padStart(10)}${status}`);
  });

  const choice = await ask('\n  Enter invoice number (or line #): ');
  let selectedInvoice;
  const lineNum = parseInt(choice);
  if (lineNum > 0 && lineNum <= stellantisInvoices.length) {
    selectedInvoice = stellantisInvoices[lineNum - 1];
  } else {
    selectedInvoice = stellantisInvoices.find(i => i.invoice_number === choice);
  }

  if (!selectedInvoice) {
    console.error('  Invoice not found.');
    process.exit(1);
  }

  console.log(`\n  Selected: Invoice #${selectedInvoice.invoice_number} - ${selectedInvoice.project_name}`);
  console.log(`  PO: ${selectedInvoice.po_number} | Amount: $${selectedInvoice.total_amount.toFixed(2)}`);

  // Step 4: Fetch full invoice details and generate PDF
  console.log('\n[4/5] Generating invoice PDF...');

  const invoiceDetail = await apiFetch(`/api/invoices/${selectedInvoice.id}`, token);

  // Build engineer names for filename
  const engineerNames = invoiceDetail.lineItems
    ? [...new Set(invoiceDetail.lineItems.map(li => li.engineer))].join(', ')
    : selectedInvoice.engineers || 'Unknown';

  // Create output directory
  if (!fs.existsSync(PDF_OUTPUT_DIR)) fs.mkdirSync(PDF_OUTPUT_DIR, { recursive: true });

  // Build filename: PO {po} - {engineer} - {project short name} - Invoice {number}.pdf
  const safeName = (s) => (s || '').replace(/[<>:"/\\|?*]/g, '_').trim();
  const poNum = (selectedInvoice.po_number || '').replace(/^PO\s*/i, '');
  // Strip PO prefix from project name if it starts with it
  const projectShortName = (selectedInvoice.project_name || '').replace(/^PO\s*\d+\s*-\s*/i, '');
  const pdfFilename = `PO ${safeName(poNum)} - ${safeName(engineerNames)} - ${safeName(projectShortName)} - Invoice ${safeName(selectedInvoice.invoice_number)}.pdf`;
  const pdfPath = path.join(PDF_OUTPUT_DIR, pdfFilename);

  await generateInvoicePdf(
    { ...selectedInvoice, ...invoiceDetail, customer_address: invoiceDetail.customer_address || '' },
    invoiceDetail.lineItems || [],
    invoiceDetail.settings || {},
    pdfPath
  );

  // Step 5: Launch eSupplier automation
  console.log('\n[5/5] Launching eSupplierConnect automation...');
  console.log('  A browser window will open. The form will be filled automatically.');
  console.log('  YOU verify everything, then click "Submit Invoice" when ready.\n');

  // Determine qty and unit price
  let qtyShipped, unitPrice;
  if (selectedInvoice.project_type === 'fixed_price' || selectedInvoice.total_hours === 0) {
    qtyShipped = 1;
    unitPrice = selectedInvoice.total_amount;
  } else {
    qtyShipped = selectedInvoice.total_hours;
    unitPrice = selectedInvoice.total_hours > 0 ? (selectedInvoice.total_amount / selectedInvoice.total_hours) : 0;
  }

  // Use current date for submission
  const invDate = new Date();
  const invoiceDate = `${String(invDate.getMonth() + 1).padStart(2, '0')}/${String(invDate.getDate()).padStart(2, '0')}/${invDate.getFullYear()}`;

  const poNumberClean = (selectedInvoice.po_number || '').replace(/^PO\s*/i, '');
  const invoiceData = {
    supplierNumber: selectedInvoice.supplier_number || '38850',
    invoiceNumber: selectedInvoice.invoice_number,
    email: 'jbsornig@utechconsulting.net',
    invoiceDate,
    poNumber: poNumberClean,
    poLineItemNumber: '00001',
    qtyShipped: Math.round(qtyShipped * 1000) / 1000,
    unitPrice: Math.round(unitPrice * 100) / 100,
  };

  console.log('  Invoice Data for CAP:');
  console.log(`    Supplier #: ${invoiceData.supplierNumber}`);
  console.log(`    Invoice #:  ${invoiceData.invoiceNumber}`);
  console.log(`    Date:       ${invoiceData.invoiceDate}`);
  console.log(`    PO:         ${invoiceData.poNumber}`);
  console.log(`    Qty:        ${invoiceData.qtyShipped}`);
  console.log(`    Unit Price: $${invoiceData.unitPrice.toFixed(2)}`);
  console.log(`    Total:      $${(invoiceData.qtyShipped * invoiceData.unitPrice).toFixed(2)}`);
  console.log(`    PDF:        ${pdfFilename}`);

  const confirm = await ask('\n  Proceed with automation? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('  Aborted.');
    process.exit(0);
  }

  try {
    await submitToESupplier({
      credentials: esupplierCreds,
      invoiceData,
      pdfPath,
      onStatus: (msg) => console.log(`  ${msg}`),
    });
    console.log('\n  ✓ Browser is open. Review and submit the invoice manually.');
    console.log('  Press Enter to exit this tool (browser stays open).\n');
    await ask('');
  } catch (err) {
    console.error(`\n  ERROR: ${err.message}`);
    console.log('  The PDF has been saved at:', pdfPath);
    console.log('  You can submit manually using the generated PDF.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
