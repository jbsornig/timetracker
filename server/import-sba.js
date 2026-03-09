/**
 * Import script for Microsoft Small Business Accounting 2006 XML export
 * Imports Customers and Jobs (Projects) into TimeTracker
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// XML file path - adjust if needed
const XML_FILE = path.join(__dirname, '..', '..', '..', 'UTech_03_08_2026.xml');
// Use the same database path logic as the server
let DATA_DIR = __dirname;
if (fs.existsSync('/data')) {
  DATA_DIR = '/data';
  console.log('Using persistent disk at /data');
}
const DB_PATH = path.join(DATA_DIR, 'timetracker.db');

// Simple XML parser for SBA export format
function parseXML(xmlContent) {
  const data = {
    customers: [],
    addresses: [],
    phones: [],
    emails: [],
    jobs: []
  };

  // Extract CustomerVendorAccountEntityView entries (customers are AccountType 9)
  const customerRegex = /<CustomerVendorAccountEntityView>([\s\S]*?)<\/CustomerVendorAccountEntityView>/g;
  let match;
  while ((match = customerRegex.exec(xmlContent)) !== null) {
    const block = match[1];
    const accountType = extractValue(block, 'AccountType');
    if (accountType === '9') { // 9 = Customer
      data.customers.push({
        accountId: extractValue(block, 'AccountID'),
        name: extractValue(block, 'Name'),
        url: extractValue(block, 'URL'),
        active: extractValue(block, 'Active') === 'true',
        displayNumber: extractValue(block, 'DisplayNumber'),
        comments: extractValue(block, 'Comments')
      });
    }
  }

  // Extract addresses
  const addressRegex = /<CustomerVendorAddressEntityView>([\s\S]*?)<\/CustomerVendorAddressEntityView>/g;
  while ((match = addressRegex.exec(xmlContent)) !== null) {
    const block = match[1];
    data.addresses.push({
      customerVendorAccountId: extractValue(block, 'CustomerVendorAccountID'),
      address1: extractValue(block, 'Address1'),
      address2: extractValue(block, 'Address2'),
      city: extractValue(block, 'City'),
      state: extractValue(block, 'State'),
      zipCode: extractValue(block, 'ZipCode')
    });
  }

  // Extract phones
  const phoneRegex = /<CustomerVendorPhoneEntityView>([\s\S]*?)<\/CustomerVendorPhoneEntityView>/g;
  while ((match = phoneRegex.exec(xmlContent)) !== null) {
    const block = match[1];
    data.phones.push({
      customerVendorAccountId: extractValue(block, 'CustomerVendorAccountID'),
      phone: extractValue(block, 'Phone')
    });
  }

  // Extract emails
  const emailRegex = /<CustomerVendorEmailEntityView>([\s\S]*?)<\/CustomerVendorEmailEntityView>/g;
  while ((match = emailRegex.exec(xmlContent)) !== null) {
    const block = match[1];
    data.emails.push({
      customerVendorAccountId: extractValue(block, 'CustomerVendorAccountID'),
      email: extractValue(block, 'Email')
    });
  }

  // Extract jobs (AccountType 12) - only Status=2 (Open/In Progress)
  const jobRegex = /<JobAccountEntityView>([\s\S]*?)<\/JobAccountEntityView>/g;
  while ((match = jobRegex.exec(xmlContent)) !== null) {
    const block = match[1];
    const status = extractValue(block, 'Status');
    // Only import active/open jobs (Status=2), skip closed ones (Status=3)
    if (status !== '2') continue;

    data.jobs.push({
      accountId: extractValue(block, 'AccountID'),
      customerId: extractValue(block, 'CustomerID'),
      name: extractValue(block, 'Name'),
      comments: extractValue(block, 'Comments'),
      status: status,
      active: extractValue(block, 'Active') === 'true',
      startDate: extractValue(block, 'StartDate'),
      endDate: extractValue(block, 'EndDate')
    });
  }

  return data;
}

function extractValue(block, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`);
  const match = block.match(regex);
  return match ? match[1].trim() : '';
}

function importData() {
  console.log('Reading XML file:', XML_FILE);

  if (!fs.existsSync(XML_FILE)) {
    console.error('XML file not found:', XML_FILE);
    process.exit(1);
  }

  const xmlContent = fs.readFileSync(XML_FILE, 'utf8');
  console.log('Parsing XML...');
  const data = parseXML(xmlContent);

  console.log(`Found ${data.customers.length} customers`);
  console.log(`Found ${data.addresses.length} addresses`);
  console.log(`Found ${data.phones.length} phones`);
  console.log(`Found ${data.emails.length} emails`);
  console.log(`Found ${data.jobs.length} jobs`);

  // Open database
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  // Map old customer IDs to new IDs
  const customerIdMap = new Map();

  // Import customers
  const insertCustomer = db.prepare(`
    INSERT INTO customers (name, contact, email, phone, address, supplier_number, payment_terms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const checkCustomer = db.prepare('SELECT id FROM customers WHERE name = ?');

  console.log('\n--- Importing Customers ---');
  for (const customer of data.customers) {
    // Skip if customer already exists
    const existing = checkCustomer.get(customer.name);
    if (existing) {
      console.log(`  Skipping existing customer: ${customer.name}`);
      customerIdMap.set(customer.accountId, existing.id);
      continue;
    }

    // Get address for this customer
    const address = data.addresses.find(a => a.customerVendorAccountId === customer.accountId);
    const phone = data.phones.find(p => p.customerVendorAccountId === customer.accountId);
    const email = data.emails.find(e => e.customerVendorAccountId === customer.accountId);

    let fullAddress = '';
    if (address) {
      const parts = [address.address1, address.address2, `${address.city}, ${address.state} ${address.zipCode}`].filter(Boolean);
      fullAddress = parts.join('\n');
    }

    try {
      const result = insertCustomer.run(
        customer.name,
        '', // contact - not in SBA export
        email?.email || '',
        phone?.phone || '',
        fullAddress,
        '', // supplier_number - leave blank, user will fill in later
        'Net 30'
      );
      customerIdMap.set(customer.accountId, result.lastInsertRowid);
      console.log(`  Imported customer: ${customer.name} (ID: ${result.lastInsertRowid})`);
    } catch (err) {
      console.error(`  Error importing customer ${customer.name}:`, err.message);
    }
  }

  // Import jobs as projects
  const insertProject = db.prepare(`
    INSERT INTO projects (customer_id, name, description, po_number, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  const checkProject = db.prepare('SELECT id FROM projects WHERE name = ? AND customer_id = ?');

  console.log('\n--- Importing Jobs as Projects ---');
  for (const job of data.jobs) {
    const newCustomerId = customerIdMap.get(job.customerId);
    if (!newCustomerId) {
      console.log(`  Skipping job "${job.name}" - customer not found (CustomerID: ${job.customerId})`);
      continue;
    }

    // Skip if project already exists for this customer
    const existing = checkProject.get(job.name, newCustomerId);
    if (existing) {
      console.log(`  Skipping existing project: ${job.name}`);
      continue;
    }

    // Determine status
    const status = job.active ? 'active' : 'inactive';

    try {
      const result = insertProject.run(
        newCustomerId,
        job.name,
        job.comments || '',
        job.name, // Use job name as PO number (often is the PO in SBA)
        status
      );
      console.log(`  Imported project: ${job.name} (ID: ${result.lastInsertRowid})`);
    } catch (err) {
      console.error(`  Error importing project ${job.name}:`, err.message);
    }
  }

  db.close();
  console.log('\n--- Import Complete ---');
}

// Run import
importData();
