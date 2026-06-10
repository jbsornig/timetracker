const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ESUPPLIER_URL = 'https://fcagroup.esupplierconnect.com/irj/portal/supplier_connect/global?guest_user=Guest_FI&fullscroll=true';
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
    // Step 1: Navigate to eSupplierConnect portal
    log('Navigating to eSupplierConnect...');
    await page.goto(ESUPPLIER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Handle cookie popup - click "ACCEPT ALL"
    log('Handling cookie popup...');
    try {
      // Try main page first
      let accepted = false;
      const acceptSelectors = [
        'button:has-text("ACCEPT ALL")',
        'button:has-text("Accept All")',
        'button:has-text("Accept all")',
        'a:has-text("ACCEPT ALL")',
        '#onetrust-accept-btn-handler',
        '[id*="accept"]',
        '[class*="accept-all"]',
        'button[title*="Accept"]',
      ];
      for (const sel of acceptSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click();
            accepted = true;
            log('Clicked accept cookies button.');
            break;
          }
        } catch (e) {}
      }
      // If not found on main page, check iframes
      if (!accepted) {
        const frames = page.frames();
        for (const frame of frames) {
          for (const sel of acceptSelectors) {
            try {
              const btn = frame.locator(sel).first();
              if (await btn.isVisible({ timeout: 1000 })) {
                await btn.click();
                accepted = true;
                log('Clicked accept cookies in iframe.');
                break;
              }
            } catch (e) {}
          }
          if (accepted) break;
        }
      }
      if (!accepted) log('Could not find cookie button, continuing...');
      await page.waitForTimeout(2000);
    } catch (e) {
      log('Cookie popup handling skipped: ' + e.message);
    }

    // Click "CLICK HERE" to remain on eSupplierConnect Supplier Portal
    log('Clicking eSupplierConnect Supplier Portal link...');
    try {
      const portalLink = page.locator('a:has-text("CLICK HERE")').first();
      await portalLink.click({ timeout: 10000 });
      await page.waitForTimeout(3000);
    } catch (e) {
      log('No portal selection page, continuing...');
    }

    // Step 2: Click Login
    log('Clicking Login...');
    // Save screenshot for debugging if login fails
    const screenshotDir = require('path').join(require('os').homedir(), 'Documents', 'FCA_Invoices');
    if (!require('fs').existsSync(screenshotDir)) require('fs').mkdirSync(screenshotDir, { recursive: true });

    let loginClicked = false;
    const loginSelectors = [
      'a:has-text("Login")',
      'a:has-text("LOGIN")',
      'button:has-text("Login")',
      'input[value="Login"]',
      'img[alt*="Login" i]',
      'a[href*="login" i]',
      '[onclick*="login" i]',
      'a:has-text("Log In")',
      '.login',
      '#login',
    ];
    for (const sel of loginSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click();
          loginClicked = true;
          log(`Login clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!loginClicked) {
      await page.screenshot({ path: require('path').join(screenshotDir, 'debug-login-page.png') });
      throw new Error('Could not find Login button. Screenshot saved to Documents/FCA_Invoices/debug-login-page.png');
    }
    await page.waitForTimeout(3000);

    // Step 3: Login form
    log('Entering credentials...');
    await page.waitForSelector('input[type="text"], input[type="password"], input[name*="user"], input[name*="User"]', { timeout: 15000 });
    const usernameField = page.locator('input[type="text"], input[name*="user" i], input[name*="User"]').first();
    const passwordField = page.locator('input[type="password"]').first();
    await usernameField.fill(credentials.username);
    await passwordField.fill(credentials.password);

    log('Clicking Sign In...');
    let signedIn = false;
    const signInSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value*="Sign" i]',
      'button:has-text("Sign")',
      'input[value*="Log" i]',
      'button:has-text("Log")',
      'a:has-text("Sign In")',
      'img[alt*="Sign" i]',
      'input[type="image"]',
      '[class*="submit" i]',
      '[class*="signin" i]',
      '[class*="login" i] button',
      'form button',
      'form input[type="button"]',
    ];
    for (const sel of signInSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          signedIn = true;
          log(`Sign In clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!signedIn) {
      // Try pressing Enter as fallback
      await passwordField.press('Enter');
      signedIn = true;
      log('Sign In: pressed Enter as fallback');
    }
    log('Signed in, waiting for portal...');
    await page.waitForTimeout(5000);

    // Step 4: Navigate to North America > Applications > Corporate Accounts Payable
    log('Clicking North America tab...');
    let naClicked = false;
    const naSelectors = [
      'a:has-text("North America")',
      'td:has-text("North America")',
      'span:has-text("North America")',
      'li:has-text("North America")',
      '[title="North America"]',
      'a[href*="north_america" i]',
      'a[href*="NorthAmerica" i]',
    ];
    // Check main page first
    for (const sel of naSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          naClicked = true;
          log(`North America clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    // Check frames if not found
    if (!naClicked) {
      const frames = page.frames();
      for (const frame of frames) {
        for (const sel of naSelectors) {
          try {
            const el = frame.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 })) {
              await el.click();
              naClicked = true;
              log(`North America clicked in frame using: ${sel}`);
              break;
            }
          } catch (e) {}
        }
        if (naClicked) break;
      }
    }
    if (!naClicked) {
      await page.screenshot({ path: require('path').join(screenshotDir, 'debug-north-america.png') });
      throw new Error('Could not find North America tab. Screenshot saved to Documents/FCA_Invoices/debug-north-america.png');
    }
    await page.waitForTimeout(3000);

    log('Navigating to Applications...');
    let appsClicked = false;
    const appsSelectors = [
      'a:has-text("Applications")',
      'td:has-text("Applications")',
      'span:has-text("Applications")',
      'li:has-text("Applications")',
      '[title="Applications"]',
      'a[href*="application" i]',
    ];
    for (const sel of appsSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          appsClicked = true;
          log(`Applications clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!appsClicked) {
      const frames = page.frames();
      for (const frame of frames) {
        for (const sel of appsSelectors) {
          try {
            const el = frame.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 })) {
              await el.click();
              appsClicked = true;
              log(`Applications clicked in frame using: ${sel}`);
              break;
            }
          } catch (e) {}
        }
        if (appsClicked) break;
      }
    }
    if (!appsClicked) {
      await page.screenshot({ path: require('path').join(screenshotDir, 'debug-applications.png') });
      throw new Error('Could not find Applications tab. Screenshot saved to Documents/FCA_Invoices/debug-applications.png');
    }
    await page.waitForTimeout(3000);

    log('Waiting for application list to load...');
    await page.waitForTimeout(5000);

    log('Opening Corporate Accounts Payable...');
    let capClicked = false;
    const capSelectors = [
      'a:has-text("Corporate Accounts Payable")',
      'td:has-text("Corporate Accounts Payable")',
      'span:has-text("Corporate Accounts Payable")',
      'a:has-text("Corporate Accounts Payable (CAP)")',
    ];
    // Try up to 3 times with waits (page may still be loading)
    for (let attempt = 0; attempt < 3 && !capClicked; attempt++) {
      for (const sel of capSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 })) {
            await el.click();
            capClicked = true;
            log(`CAP clicked using: ${sel}`);
            break;
          }
        } catch (e) {}
      }
      if (!capClicked) {
        const frames = page.frames();
        for (const frame of frames) {
          for (const sel of capSelectors) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 1000 })) {
                await el.click();
                capClicked = true;
                log(`CAP clicked in frame using: ${sel}`);
                break;
              }
            } catch (e) {}
          }
          if (capClicked) break;
        }
      }
      if (!capClicked) {
        log(`CAP not found yet, waiting... (attempt ${attempt + 1}/3)`);
        await page.waitForTimeout(3000);
      }
    }
    if (!capClicked) {
      await page.screenshot({ path: require('path').join(screenshotDir, 'debug-cap.png') });
      throw new Error('Could not find Corporate Accounts Payable link. Screenshot saved to Documents/FCA_Invoices/debug-cap.png');
    }
    await page.waitForTimeout(5000);

    // CAP opens in a new tab/window - wait for it and switch
    log('Waiting for CAP page to open...');
    let capPage;
    try {
      capPage = await context.waitForEvent('page', { timeout: 15000 });
      await capPage.waitForLoadState('domcontentloaded');
    } catch (e) {
      // If no new page event, check existing pages
      const pages = context.pages();
      capPage = pages[pages.length - 1];
    }
    await capPage.waitForTimeout(5000);
    await capPage.bringToFront();

    // Step 5: Click create invoice link
    log('Looking for Create Invoice link...');
    let createClicked = false;
    const createSelectors = [
      'a:has-text("Create Invoice")',
      'a:has-text("New Invoice")',
      'a:has-text("New Invoice Status")',
      'a:has-text("Express Entry")',
      'a[href*="create" i]',
      'a[href*="newInvoice" i]',
      'a[href*="capspin" i]',
    ];
    for (let attempt = 0; attempt < 3 && !createClicked; attempt++) {
      for (const sel of createSelectors) {
        try {
          const el = capPage.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click();
            createClicked = true;
            log(`Create Invoice clicked using: ${sel}`);
            break;
          }
        } catch (e) {}
      }
      // Also check frames on the CAP page
      if (!createClicked) {
        const frames = capPage.frames();
        for (const frame of frames) {
          for (const sel of createSelectors) {
            try {
              const el = frame.locator(sel).first();
              if (await el.isVisible({ timeout: 1000 })) {
                await el.click();
                createClicked = true;
                log(`Create Invoice clicked in frame using: ${sel}`);
                break;
              }
            } catch (e) {}
          }
          if (createClicked) break;
        }
      }
      if (!createClicked) {
        log(`Create Invoice link not found, waiting... (attempt ${attempt + 1}/3)`);
        await capPage.waitForTimeout(3000);
      }
    }
    if (!createClicked) {
      await capPage.screenshot({ path: require('path').join(screenshotDir, 'debug-cap-page.png') });
      throw new Error('Could not find Create Invoice link. Screenshot saved to Documents/FCA_Invoices/debug-cap-page.png');
    }
    await capPage.waitForTimeout(3000);

    // Step 6: Fill Create Invoice form - find the right page/frame context
    log('Filling invoice details...');

    // The Create Invoice form might be on a new page or in a frame
    // Check all open pages for the supplier field
    let formPage = null;
    let formFrame = null;
    await capPage.waitForTimeout(3000);

    // First check if a new page opened
    const allPages = context.pages();
    for (const pg of allPages) {
      try {
        const field = pg.locator('input[name*="supplier" i]').first();
        if (await field.isVisible({ timeout: 2000 })) {
          formPage = pg;
          log('Found form on a page tab');
          break;
        }
      } catch (e) {}
      // Check frames within this page
      for (const frame of pg.frames()) {
        try {
          const field = frame.locator('input[name*="supplier" i]').first();
          if (await field.isVisible({ timeout: 1000 })) {
            formPage = pg;
            formFrame = frame;
            log('Found form in a frame');
            break;
          }
        } catch (e) {}
      }
      if (formPage) break;
    }

    if (!formPage) {
      await capPage.screenshot({ path: require('path').join(screenshotDir, 'debug-create-invoice.png') });
      throw new Error('Could not find Create Invoice form. Screenshot saved to Documents/FCA_Invoices/debug-create-invoice.png');
    }

    await formPage.bringToFront();
    let formCtx = formFrame || formPage;

    // Supplier Number
    const supplierField = formCtx.locator('input[name*="supplier" i]').first();
    await supplierField.fill(invoiceData.supplierNumber);

    // Tab out to trigger supplier data load (page may reload)
    await supplierField.press('Tab');
    log('Waiting for supplier data to load...');
    await formPage.waitForTimeout(5000);

    // After supplier lookup, the page/frame may have refreshed - re-find the form context
    let formCtxRefreshed = formCtx;
    if (formFrame) {
      // Re-check frames as they may have reloaded
      for (const frame of formPage.frames()) {
        try {
          const check = frame.locator('input[name*="email" i]').first();
          if (await check.isVisible({ timeout: 2000 })) {
            formCtxRefreshed = frame;
            break;
          }
        } catch (e) {}
      }
    }
    formCtx = formCtxRefreshed;

    // Email Address (fill first since it's next in tab order)
    log('Filling email...');
    const emailField = formCtx.locator('input[name*="email" i]').first();
    await emailField.fill(invoiceData.email);

    // Invoice Number - try multiple selectors since field name varies
    log('Filling invoice number...');
    let invNumFilled = false;
    const invNumSelectors = [
      'input[name*="invoiceNum" i]',
      'input[name*="invoice_num" i]',
      'input[name*="invNum" i]',
      'input[name*="invoiceNo" i]',
      'input[name*="inv_no" i]',
      'input[name*="number" i]',
    ];
    for (const sel of invNumSelectors) {
      try {
        const fields = formCtx.locator(sel);
        const count = await fields.count();
        for (let i = 0; i < count; i++) {
          const field = fields.nth(i);
          if (await field.isVisible({ timeout: 1000 })) {
            // Make sure it's not the supplier number field
            const val = await field.inputValue();
            if (val !== invoiceData.supplierNumber) {
              await field.fill(invoiceData.invoiceNumber);
              invNumFilled = true;
              log(`Invoice number filled using: ${sel}`);
              break;
            }
          }
        }
        if (invNumFilled) break;
      } catch (e) {}
    }
    if (!invNumFilled) {
      // Fallback: try to find by label text proximity
      try {
        const label = formCtx.locator('text=Invoice Number').first();
        const input = formCtx.locator('input').nth(1);
        // Find inputs near the invoice number label - just try the second visible input
        const allInputs = formCtx.locator('input[type="text"]');
        const inputCount = await allInputs.count();
        for (let i = 0; i < inputCount; i++) {
          const inp = allInputs.nth(i);
          const val = await inp.inputValue().catch(() => '');
          if (val === '' && await inp.isVisible()) {
            await inp.fill(invoiceData.invoiceNumber);
            invNumFilled = true;
            log('Invoice number filled using positional fallback');
            break;
          }
        }
      } catch (e) {}
    }
    if (!invNumFilled) {
      await formPage.screenshot({ path: require('path').join(screenshotDir, 'debug-invoice-num.png') });
      throw new Error('Could not find Invoice Number field. Screenshot saved.');
    }

    // Material Type dropdown - select "In-Direct"
    const materialType = formCtx.locator('select[name*="material" i]').first();
    await materialType.selectOption({ label: 'In-Direct' });

    // Invoice Type should already be "Invoice" but set it
    try {
      const invoiceType = formCtx.locator('select[name*="type" i]').last();
      await invoiceType.selectOption({ label: 'Invoice' });
    } catch (e) {}

    // Invoice Date - find by trying multiple selectors
    log('Filling dates...');
    const dateSelectors = [
      'input[name*="invoiceDate" i]',
      'input[name*="invDate" i]',
      'input[name*="inv_date" i]',
      'input[name*="date" i]',
    ];
    let dateFields = [];
    for (const sel of dateSelectors) {
      try {
        const fields = formCtx.locator(sel);
        const count = await fields.count();
        if (count > 0) {
          for (let i = 0; i < count; i++) {
            if (await fields.nth(i).isVisible({ timeout: 1000 })) {
              dateFields.push(fields.nth(i));
            }
          }
        }
        if (dateFields.length > 0) break;
      } catch (e) {}
    }
    if (dateFields.length >= 2) {
      // First date field = Invoice Date, Second = Shipped Date
      await dateFields[0].fill(invoiceData.invoiceDate);
      await dateFields[1].fill(invoiceData.invoiceDate);
      log(`Filled ${dateFields.length} date fields.`);
    } else if (dateFields.length === 1) {
      await dateFields[0].fill(invoiceData.invoiceDate);
      log('Filled 1 date field.');
    } else {
      await formPage.screenshot({ path: require('path').join(screenshotDir, 'debug-dates.png') });
      throw new Error('Could not find date fields. Screenshot saved.');
    }

    // Shipped Via - find select dropdowns and pick the right one
    try {
      const allSelects = formCtx.locator('select');
      const selectCount = await allSelects.count();
      let shippedViaSet = false;
      for (let i = 0; i < selectCount; i++) {
        const sel = allSelects.nth(i);
        try {
          const options = await sel.locator('option').allTextContents();
          if (options.some(o => o.includes('Other'))) {
            // Skip material type and invoice type selects (already set)
            if (!options.some(o => o.includes('In-Direct')) && !options.some(o => o.includes('Invoice'))) {
              await sel.selectOption({ label: 'Other' });
              shippedViaSet = true;
              log('Shipped Via set to Other.');
              break;
            }
          }
        } catch (e2) {}
      }
      if (!shippedViaSet) log('Could not identify Shipped Via dropdown, continuing...');
    } catch (e) {
      log('Could not set Shipped Via, continuing...');
    }

    await formPage.waitForTimeout(1000);
    log('Invoice details filled.');

    // Step 7: Add Attachment
    log('Adding PDF attachment...');
    // Listen for popup before clicking
    const attachPopupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    let attachClicked = false;
    const attachBtnSelectors = [
      'input[value*="Add Attachment"]',
      'input[value*="Attachment"]',
      'button:has-text("Add Attachment")',
      'a:has-text("Add Attachment")',
      'input[type="button"][value*="Attach"]',
      'input[type="submit"][value*="Attach"]',
    ];
    for (const sel of attachBtnSelectors) {
      try {
        const btn = formCtx.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          attachClicked = true;
          log(`Add Attachment clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!attachClicked) {
      await formPage.screenshot({ path: require('path').join(screenshotDir, 'debug-attachment-btn.png') });
      throw new Error('Could not find Add Attachment button. Screenshot saved.');
    }
    await formPage.waitForTimeout(3000);

    // Handle attachment popup - find the new window
    log('Waiting for attachment popup...');
    let attachPage = await attachPopupPromise;
    if (!attachPage) {
      // Try to find the popup among all pages
      await formPage.waitForTimeout(3000);
      const currentPages = context.pages();
      attachPage = currentPages[currentPages.length - 1];
    }
    await attachPage.waitForLoadState('domcontentloaded');
    await attachPage.waitForTimeout(3000);
    await attachPage.bringToFront();

    // Handle confirmation dialogs automatically
    attachPage.on('dialog', async dialog => {
      log(`Dialog: "${dialog.message()}" - accepting...`);
      await dialog.accept();
    });

    // Find file input - check page and frames
    log('Uploading PDF file...');
    let fileUploaded = false;
    try {
      const fileInput = attachPage.locator('input[type="file"]').first();
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(pdfPath);
        fileUploaded = true;
      }
    } catch (e) {}
    if (!fileUploaded) {
      for (const frame of attachPage.frames()) {
        try {
          const fileInput = frame.locator('input[type="file"]').first();
          if (await fileInput.isVisible({ timeout: 2000 })) {
            await fileInput.setInputFiles(pdfPath);
            fileUploaded = true;
            break;
          }
        } catch (e) {}
      }
    }
    if (!fileUploaded) {
      await attachPage.screenshot({ path: require('path').join(screenshotDir, 'debug-attach-popup.png') });
      throw new Error('Could not find file input in attachment popup. Screenshot saved.');
    }
    await attachPage.waitForTimeout(2000);

    // Click Attach button
    log('Clicking Attach button...');
    let attachBtnClicked = false;
    const attachBtnSels = [
      'input[value="Attach"]',
      'input[value*="Attach"]',
      'button:has-text("Attach")',
      'a:has-text("Attach")',
    ];
    for (const sel of attachBtnSels) {
      try {
        const btn = attachPage.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          attachBtnClicked = true;
          log(`Attach clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    // Also check frames
    if (!attachBtnClicked) {
      for (const frame of attachPage.frames()) {
        for (const sel of attachBtnSels) {
          try {
            const btn = frame.locator(sel).first();
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click();
              attachBtnClicked = true;
              log(`Attach clicked in frame using: ${sel}`);
              break;
            }
          } catch (e) {}
        }
        if (attachBtnClicked) break;
      }
    }
    if (!attachBtnClicked) {
      await attachPage.screenshot({ path: require('path').join(screenshotDir, 'debug-attach-btn.png') });
      throw new Error('Could not click Attach button. Screenshot saved.');
    }

    // The attachment popup will close itself after attaching - wait and handle gracefully
    try {
      await attachPage.waitForTimeout(3000);
      // Try to close if still open
      const closeBtn = attachPage.locator('input[value="Close"], button:has-text("Close")').first();
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click();
      }
    } catch (e) {
      // Popup closed itself - this is expected
      log('Attachment popup closed.');
    }

    // Switch back to the main form page
    await formPage.bringToFront();
    await formPage.waitForTimeout(2000);
    log('Attachment added.');

    // Step 8: Add Line Item
    log('Adding line item...');
    const addLineItemPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    let lineItemClicked = false;
    const lineItemBtnSels = [
      'input[value*="Add Line Item"]',
      'input[value*="Line Item"]',
      'button:has-text("Add Line Item")',
      'a:has-text("Add Line Item")',
      'input[type="button"][value*="Line"]',
    ];
    for (const sel of lineItemBtnSels) {
      try {
        const btn = formCtx.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          lineItemClicked = true;
          log(`Add Line Item clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!lineItemClicked) {
      await formPage.screenshot({ path: require('path').join(screenshotDir, 'debug-add-line-item.png') });
      throw new Error('Could not find Add Line Item button. Screenshot saved.');
    }
    await formPage.waitForTimeout(3000);

    // Line Item form might be on a new page/tab or in a frame
    let linePage = await addLineItemPromise;
    if (linePage) {
      await linePage.waitForLoadState('domcontentloaded');
    }
    await formPage.waitForTimeout(3000);

    // Search all pages and frames for the PO number input
    let lineCtx = null;
    linePage = null;
    const allPagesNow = context.pages();
    for (const pg of allPagesNow) {
      // Check page directly
      try {
        const field = pg.locator('input[type="text"]').first();
        const title = await pg.title().catch(() => '');
        if (title.toLowerCase().includes('line item') || title.toLowerCase().includes('add line')) {
          lineCtx = pg;
          linePage = pg;
          log('Found line item form on page: ' + title);
          break;
        }
      } catch (e) {}
      // Check frames
      for (const frame of pg.frames()) {
        try {
          const url = frame.url();
          if (url.includes('lineItem') || url.includes('LineItem') || url.includes('addLine')) {
            lineCtx = frame;
            linePage = pg;
            log('Found line item form in frame: ' + url.slice(0, 60));
            break;
          }
        } catch (e) {}
      }
      if (lineCtx) break;
    }

    // If not found by URL/title, search for visible text inputs on newest page
    if (!lineCtx) {
      const newestPage = allPagesNow[allPagesNow.length - 1];
      await newestPage.bringToFront();
      await newestPage.waitForTimeout(2000);
      // Check the page itself
      try {
        const inputs = newestPage.locator('input[type="text"]');
        if (await inputs.count() > 2) {
          lineCtx = newestPage;
          linePage = newestPage;
          log('Found line item form on newest page');
        }
      } catch (e) {}
      // Check frames on newest page
      if (!lineCtx) {
        for (const frame of newestPage.frames()) {
          try {
            const inputs = frame.locator('input[type="text"]');
            if (await inputs.count() > 2) {
              lineCtx = frame;
              linePage = newestPage;
              log('Found line item form in frame on newest page');
              break;
            }
          } catch (e) {}
        }
      }
      if (!lineCtx) {
        // Last resort - use formCtx (same frame as invoice form)
        lineCtx = formCtx;
        linePage = formPage;
        log('Using original form context for line item');
      }
    }
    if (linePage) await linePage.bringToFront();

    // P.O. Number - find the first text input on the line item form
    log('Filling PO number...');
    let poField;
    const poSelectors = [
      'input[name*="poNum" i]',
      'input[name*="po_num" i]',
      'input[name*="purchaseOrder" i]',
      'input[name*="PO" i]',
    ];
    let poFilled = false;
    for (const sel of poSelectors) {
      try {
        const field = lineCtx.locator(sel).first();
        if (await field.isVisible({ timeout: 2000 })) {
          await field.fill(invoiceData.poNumber);
          poField = field;
          poFilled = true;
          log(`PO filled using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    // Fallback: use the first visible text input (PO is the first field on the line item form)
    if (!poFilled) {
      try {
        const inputs = lineCtx.locator('input[type="text"]');
        const count = await inputs.count();
        for (let i = 0; i < count; i++) {
          const inp = inputs.nth(i);
          if (await inp.isVisible({ timeout: 1000 })) {
            await inp.fill(invoiceData.poNumber);
            poField = inp;
            poFilled = true;
            log('PO filled using first visible text input');
            break;
          }
        }
      } catch (e) {}
    }
    if (!poFilled) {
      if (linePage) await linePage.screenshot({ path: require('path').join(screenshotDir, 'debug-line-item.png') });
      throw new Error('Could not find PO Number field. Screenshot saved.');
    }

    // Tab to trigger PO lookup
    await poField.press('Tab');
    log('Waiting for PO data to load...');
    await linePage.waitForTimeout(3000);

    // Use positional approach for line item fields
    // Form layout: PO Number, Part/Item Number, PO Line Item Number, Packing Slip, Qty Shipped, (UoM select), Unit Price, (Price Factor select), (Price UoM select)
    const visibleInputs = lineCtx.locator('input[type="text"]:visible');
    const inputCount = await visibleInputs.count();
    log(`Found ${inputCount} visible text inputs on line item form.`);

    // Index 0 = PO Number (already filled)
    // Index 1 = Part/Item Number (skip)
    // Index 2 = PO Line Item Number
    // Index 3 = Packing Slip/Delivery Note
    // Index 4 = Qty Shipped
    // Index 5 = Unit Price

    if (inputCount >= 6) {
      // PO Line Item Number (index 2)
      log('Filling PO Line Item Number...');
      await visibleInputs.nth(2).fill(invoiceData.poLineItemNumber);
      await visibleInputs.nth(2).press('Tab');
      await linePage.waitForTimeout(1000);

      // Packing Slip - should auto-populate after PO + line item are entered
      // Skip it - let the system fill it

      // Qty Shipped (index 4)
      log('Filling Qty Shipped...');
      await visibleInputs.nth(4).fill(String(invoiceData.qtyShipped));

      // Unit Price (index 5)
      log('Filling Unit Price...');
      await visibleInputs.nth(5).fill(String(invoiceData.unitPrice));
    } else {
      // Fallback: try to fill by position with whatever we have
      log(`Unexpected input count (${inputCount}), trying sequential fill...`);
      if (inputCount >= 3) await visibleInputs.nth(2).fill(invoiceData.poLineItemNumber);
      if (inputCount >= 5) await visibleInputs.nth(4).fill(String(invoiceData.qtyShipped));
      if (inputCount >= 6) await visibleInputs.nth(5).fill(String(invoiceData.unitPrice));
    }

    // Quantity Unit of Measure - select "LO"
    log('Setting Unit of Measure...');
    try {
      const selects = lineCtx.locator('select:visible');
      const selectCount = await selects.count();
      for (let i = 0; i < selectCount; i++) {
        try {
          const options = await selects.nth(i).locator('option').allTextContents();
          if (options.some(o => o.includes('LO'))) {
            await selects.nth(i).selectOption({ label: 'LO' });
          }
        } catch (e) {}
      }
    } catch (e) {
      log('Could not set UoM dropdowns, continuing...');
    }

    // Save line item
    log('Saving line item...');
    let saveBtnClicked = false;
    const saveSels = ['input[value="Save"]', 'button:has-text("Save")', 'a:has-text("Save")'];
    for (const sel of saveSels) {
      try {
        const btn = lineCtx.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          saveBtnClicked = true;
          log(`Save clicked using: ${sel}`);
          break;
        }
      } catch (e) {}
    }
    if (!saveBtnClicked) {
      log('Could not find Save button.');
    }
    await formPage.waitForTimeout(3000);

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
