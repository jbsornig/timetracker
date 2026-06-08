const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ESUPPLIER_URL = 'https://esupplierconnect.com/eSCPortal/supplier_connect/global/guest_user/main1/StartupRedirection.html';
const CAP_URL = 'https://gsp.extra.chrysler.com/capspin/';

async function submitToESupplier({ credentials, invoiceData, pdfPath, onStatus }) {
  const log = (msg) => {
    if (onStatus) onStatus(msg);
    console.log(`[eSupplier] ${msg}`);
  };

  log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    // Step 1: Navigate to eSupplierConnect
    log('Navigating to eSupplierConnect...');
    await page.goto(ESUPPLIER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click "CLICK HERE" to remain on eSupplierConnect Supplier Portal
    log('Clicking eSupplierConnect Supplier Portal link...');
    const portalLink = page.locator('a:has-text("CLICK HERE")').first();
    await portalLink.click();
    await page.waitForTimeout(3000);

    // Step 2: Click Login
    log('Clicking Login...');
    const loginBtn = page.locator('a:has-text("Login"), input[value="Login"], button:has-text("Login")').first();
    await loginBtn.click();
    await page.waitForTimeout(3000);

    // Step 3: Login form
    log('Entering credentials...');
    await page.waitForSelector('input[type="text"], input[name*="user"], input[name*="User"]', { timeout: 15000 });
    const usernameField = page.locator('input[type="text"], input[name*="user"], input[name*="User"]').first();
    const passwordField = page.locator('input[type="password"]').first();
    await usernameField.fill(credentials.username);
    await passwordField.fill(credentials.password);

    const signInBtn = page.locator('input[type="submit"], button[type="submit"], input[value*="Sign"], button:has-text("Sign")').first();
    await signInBtn.click();
    log('Signed in, waiting for portal...');
    await page.waitForTimeout(5000);

    // Step 4: Navigate to Applications > Corporate Accounts Payable
    log('Navigating to Applications...');
    const applicationsTab = page.locator('a:has-text("Applications"), td:has-text("Applications")').first();
    await applicationsTab.click();
    await page.waitForTimeout(3000);

    log('Opening Corporate Accounts Payable...');
    const capLink = page.locator('a:has-text("Corporate Accounts Payable")');
    await capLink.click();
    await page.waitForTimeout(5000);

    // CAP might open in a new tab/window
    const pages = context.pages();
    const capPage = pages[pages.length - 1];
    await capPage.waitForTimeout(2000);

    // Step 5: Click "New Invoice Status - RCA/F" or create invoice link
    log('Looking for Create Invoice link...');
    const newInvoiceLink = capPage.locator('a:has-text("New Invoice"), a:has-text("Create Invoice")').first();
    await newInvoiceLink.click();
    await capPage.waitForTimeout(3000);

    // Step 6: Fill Create Invoice form
    log('Filling invoice details...');

    // Supplier Number
    const supplierField = capPage.locator('input[name*="supplier" i], input[name*="Supplier" i]').first();
    await supplierField.fill(invoiceData.supplierNumber);

    // Tab out or click the lookup icon to trigger supplier data load
    await supplierField.press('Tab');
    await capPage.waitForTimeout(2000);

    // Invoice Number
    const invoiceNumField = capPage.locator('input[name*="invoice" i][name*="num" i], input[name*="Invoice" i][name*="Num" i]').first();
    await invoiceNumField.fill(invoiceData.invoiceNumber);

    // Email Address
    const emailField = capPage.locator('input[name*="email" i]').first();
    await emailField.fill(invoiceData.email);

    // Material Type dropdown - select "In-Direct"
    const materialType = capPage.locator('select[name*="material" i], select[name*="Material" i]').first();
    await materialType.selectOption({ label: 'In-Direct' });

    // Invoice Type should already be "Invoice" but set it
    const invoiceType = capPage.locator('select[name*="invoiceType" i], select[name*="InvoiceType" i], select[name*="type" i]').first();
    try {
      await invoiceType.selectOption({ label: 'Invoice' });
    } catch (e) {
      // May already be set
    }

    // Invoice Date
    const invoiceDateField = capPage.locator('input[name*="invoiceDate" i], input[name*="InvoiceDate" i], input[name*="invoice_date" i]').first();
    await invoiceDateField.fill(invoiceData.invoiceDate);

    // Shipped Date (same as invoice date)
    const shippedDateField = capPage.locator('input[name*="shippedDate" i], input[name*="ShippedDate" i], input[name*="shipped_date" i]').first();
    await shippedDateField.fill(invoiceData.invoiceDate);

    // Shipped Via - select "Other"
    const shippedVia = capPage.locator('select[name*="shipped" i][name*="via" i], select[name*="Shipped" i][name*="Via" i]').first();
    await shippedVia.selectOption({ label: 'Other' });

    await capPage.waitForTimeout(1000);

    // Step 7: Add Attachment
    log('Adding PDF attachment...');
    const addAttachmentBtn = capPage.locator('input[value*="Add Attachment"], button:has-text("Add Attachment")').first();
    await addAttachmentBtn.click();
    await capPage.waitForTimeout(2000);

    // Handle attachment popup/dialog
    const allPages = context.pages();
    const attachPage = allPages[allPages.length - 1];

    // Upload file
    const fileInput = attachPage.locator('input[type="file"]').first();
    await fileInput.setInputFiles(pdfPath);
    await attachPage.waitForTimeout(1000);

    // Click Attach
    const attachBtn = attachPage.locator('input[value="Attach"], button:has-text("Attach")').first();
    await attachBtn.click();
    await attachPage.waitForTimeout(1000);

    // Handle confirmation dialog
    attachPage.on('dialog', async dialog => {
      await dialog.accept();
    });
    await attachPage.waitForTimeout(2000);

    // Close attachment window
    const closeBtn = attachPage.locator('input[value="Close"], button:has-text("Close")').first();
    try {
      await closeBtn.click();
    } catch (e) {
      // Window may have auto-closed
    }
    await capPage.waitForTimeout(2000);

    // Step 8: Add Line Item
    log('Adding line item...');
    const addLineItemBtn = capPage.locator('input[value*="Add Line Item"], button:has-text("Add Line Item")').first();
    await addLineItemBtn.click();
    await capPage.waitForTimeout(3000);

    // Line Item form (may be on same page or new page)
    const linePages = context.pages();
    const linePage = linePages[linePages.length - 1];

    // P.O. Number
    const poField = linePage.locator('input[name*="po" i][name*="num" i], input[name*="PO" i], input[name*="purchaseOrder" i]').first();
    await poField.fill(invoiceData.poNumber);

    // Tab to trigger PO lookup
    await poField.press('Tab');
    await linePage.waitForTimeout(2000);

    // PO Line Item Number
    const poLineField = linePage.locator('input[name*="poLine" i], input[name*="lineItem" i], input[name*="POLine" i]').first();
    await poLineField.fill(invoiceData.poLineItemNumber);
    await poLineField.press('Tab');
    await linePage.waitForTimeout(1000);

    // Packing Slip/Delivery Note - should auto-populate, but fill if empty
    const packingSlipField = linePage.locator('input[name*="packing" i], input[name*="delivery" i], input[name*="Packing" i]').first();
    const packingValue = await packingSlipField.inputValue();
    if (!packingValue) {
      await packingSlipField.fill(invoiceData.poNumber);
    }

    // Qty Shipped
    const qtyField = linePage.locator('input[name*="qty" i], input[name*="Qty" i], input[name*="quantity" i]').first();
    await qtyField.fill(String(invoiceData.qtyShipped));

    // Quantity Unit of Measure - select "LO"
    const qtyUom = linePage.locator('select[name*="quantityU" i], select[name*="qtyU" i], select[name*="QuantityU" i]').first();
    try {
      await qtyUom.selectOption({ label: 'LO' });
    } catch (e) {
      await qtyUom.selectOption({ value: 'LO' });
    }

    // Unit Price
    const unitPriceField = linePage.locator('input[name*="unitPrice" i], input[name*="price" i], input[name*="UnitPrice" i]').first();
    await unitPriceField.fill(String(invoiceData.unitPrice));

    // Price Unit of Measure - select "LO"
    const priceUom = linePage.locator('select[name*="priceU" i], select[name*="PriceU" i]').first();
    try {
      await priceUom.selectOption({ label: 'LO' });
    } catch (e) {
      await priceUom.selectOption({ value: 'LO' });
    }

    // Save line item
    log('Saving line item...');
    const saveBtn = linePage.locator('input[value="Save"], button:has-text("Save")').first();
    await saveBtn.click();
    await capPage.waitForTimeout(3000);

    // Step 9: STOP - let user verify
    log('AUTOMATION COMPLETE - Invoice is ready for your review.');
    log('Please verify all fields and click "Validate Invoice" then "Submit Invoice" when ready.');
    log('The browser will remain open for you to review and submit.');

    return {
      success: true,
      message: 'Invoice form filled successfully. Browser is open for your review and manual submission.',
      browser,
    };
  } catch (err) {
    log(`Error: ${err.message}`);
    await browser.close();
    throw err;
  }
}

module.exports = { submitToESupplier };
