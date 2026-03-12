/**
 * One-time script to import banking info from CSV
 * Run with: node server/import-banking.js
 *
 * This updates banking info WITHOUT touching passwords
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Database path
const DB_PATH = path.join(__dirname, 'timetracker.db');

// CSV path
const CSV_PATH = path.join(__dirname, '..', '..', '..', 'allVendors_V1.csv');

console.log('Banking Info Import Script');
console.log('==========================\n');
console.log('Database:', DB_PATH);
console.log('CSV File:', CSV_PATH);
console.log('');

// Check files exist
if (!fs.existsSync(DB_PATH)) {
  console.error('ERROR: Database not found at', DB_PATH);
  process.exit(1);
}
if (!fs.existsSync(CSV_PATH)) {
  console.error('ERROR: CSV file not found at', CSV_PATH);
  process.exit(1);
}

// Read and parse CSV
const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = csvContent.trim().split('\n');
const headers = lines[0].split(',');

// Parse CSV rows
const vendors = [];
for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(',');
  const row = {};
  headers.forEach((h, idx) => {
    row[h.trim()] = values[idx]?.trim() || '';
  });
  vendors.push(row);
}

console.log(`Found ${vendors.length} vendors in CSV\n`);

// Connect to database
const db = new Database(DB_PATH);

// Run migrations to ensure columns exist
console.log('Checking database columns...');
const userCols = db.prepare("PRAGMA table_info(users)").all();
const colNames = userCols.map(c => c.name);

if (!colNames.includes('bank_routing')) {
  db.exec('ALTER TABLE users ADD COLUMN bank_routing TEXT');
  console.log('  Added bank_routing column');
}
if (!colNames.includes('bank_account')) {
  db.exec('ALTER TABLE users ADD COLUMN bank_account TEXT');
  console.log('  Added bank_account column');
}
if (!colNames.includes('bank_account_type')) {
  db.exec("ALTER TABLE users ADD COLUMN bank_account_type TEXT DEFAULT 'checking'");
  console.log('  Added bank_account_type column');
}
if (!colNames.includes('bank_routing_2')) {
  db.exec('ALTER TABLE users ADD COLUMN bank_routing_2 TEXT');
  console.log('  Added bank_routing_2 column');
}
if (!colNames.includes('bank_account_2')) {
  db.exec('ALTER TABLE users ADD COLUMN bank_account_2 TEXT');
  console.log('  Added bank_account_2 column');
}
if (!colNames.includes('bank_account_type_2')) {
  db.exec("ALTER TABLE users ADD COLUMN bank_account_type_2 TEXT DEFAULT 'checking'");
  console.log('  Added bank_account_type_2 column');
}
if (!colNames.includes('bank_pct_1')) {
  db.exec('ALTER TABLE users ADD COLUMN bank_pct_1 INTEGER DEFAULT 100');
  console.log('  Added bank_pct_1 column');
}
if (!colNames.includes('bank_pct_2')) {
  db.exec('ALTER TABLE users ADD COLUMN bank_pct_2 INTEGER DEFAULT 0');
  console.log('  Added bank_pct_2 column');
}
console.log('');

// Get all engineers from database
const engineers = db.prepare("SELECT id, name, email FROM users WHERE role = 'engineer'").all();
console.log(`Found ${engineers.length} engineers in database\n`);

// Build mapping of normalized names to engineers
function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

const engineerMap = {};
engineers.forEach(eng => {
  engineerMap[normalizeName(eng.name)] = eng;
});

// Process vendors and identify split deposits
const splitDeposits = {};
const singleDeposits = [];

vendors.forEach(v => {
  const name = v.VendorName;
  const nickname = v.VendorNickname;

  // Check if this is part of a split (has percentage in name)
  const pctMatch = name.match(/(\d+)\s*percent/i);

  if (pctMatch) {
    // This is a split deposit entry
    const baseName = nickname.replace(/\s*(checking|savings|\d+\s*percent)/gi, '').trim();
    const normalizedBase = normalizeName(baseName);

    if (!splitDeposits[normalizedBase]) {
      splitDeposits[normalizedBase] = { baseName, accounts: [] };
    }

    splitDeposits[normalizedBase].accounts.push({
      pct: parseInt(pctMatch[1]),
      type: v.BankAccountType.toLowerCase(),
      routing: v.BankRoutingNumber,
      account: v.BankAccountNumber
    });
  } else if (name.includes(' - ')) {
    // Alternative split format: "Name - XX%"
    const pctMatch2 = name.match(/-\s*(\d+)%/);
    if (pctMatch2) {
      const baseName = nickname.replace(/\s*(checking|savings)/gi, '').trim();
      const normalizedBase = normalizeName(baseName);

      if (!splitDeposits[normalizedBase]) {
        splitDeposits[normalizedBase] = { baseName, accounts: [] };
      }

      splitDeposits[normalizedBase].accounts.push({
        pct: parseInt(pctMatch2[1]),
        type: v.BankAccountType.toLowerCase(),
        routing: v.BankRoutingNumber,
        account: v.BankAccountNumber
      });
    } else {
      singleDeposits.push(v);
    }
  } else {
    singleDeposits.push(v);
  }
});

console.log('Split deposits detected:');
Object.entries(splitDeposits).forEach(([key, data]) => {
  console.log(`  - ${data.baseName}: ${data.accounts.map(a => `${a.pct}% ${a.type}`).join(' / ')}`);
});
console.log('');

// Prepare update statement
const updateSingle = db.prepare(`
  UPDATE users SET
    bank_routing = ?,
    bank_account = ?,
    bank_account_type = ?,
    bank_pct_1 = 100,
    bank_pct_2 = 0
  WHERE id = ?
`);

const updateSplit = db.prepare(`
  UPDATE users SET
    bank_routing = ?,
    bank_account = ?,
    bank_account_type = ?,
    bank_routing_2 = ?,
    bank_account_2 = ?,
    bank_account_type_2 = ?,
    bank_pct_1 = ?,
    bank_pct_2 = ?
  WHERE id = ?
`);

let updated = 0;
let notFound = [];

// Process single deposits
console.log('Processing single deposits...');
singleDeposits.forEach(v => {
  const normalizedName = normalizeName(v.VendorNickname || v.VendorName);
  const engineer = engineerMap[normalizedName];

  if (engineer) {
    updateSingle.run(
      v.BankRoutingNumber,
      v.BankAccountNumber,
      v.BankAccountType.toLowerCase(),
      engineer.id
    );
    console.log(`  Updated: ${engineer.name} (${v.BankAccountType} ...${v.BankAccountNumber.slice(-4)})`);
    updated++;
  } else {
    notFound.push(v.VendorName);
  }
});

// Process split deposits
console.log('\nProcessing split deposits...');
Object.entries(splitDeposits).forEach(([normalizedBase, data]) => {
  const engineer = engineerMap[normalizedBase];

  if (engineer) {
    // Sort accounts by percentage (higher first = primary)
    data.accounts.sort((a, b) => b.pct - a.pct);

    if (data.accounts.length >= 2) {
      const primary = data.accounts[0];
      const secondary = data.accounts[1];

      updateSplit.run(
        primary.routing,
        primary.account,
        primary.type,
        secondary.routing,
        secondary.account,
        secondary.type,
        primary.pct,
        secondary.pct,
        engineer.id
      );
      console.log(`  Updated: ${engineer.name} (${primary.pct}% ${primary.type} / ${secondary.pct}% ${secondary.type})`);
      updated++;
    }
  } else {
    notFound.push(data.baseName);
  }
});

console.log('\n==========================');
console.log(`Updated: ${updated} engineers`);
if (notFound.length > 0) {
  console.log(`\nNot found in database (${notFound.length}):`);
  notFound.forEach(n => console.log(`  - ${n}`));
  console.log('\nNote: These may be vendors, not engineers, or names may not match exactly.');
}

db.close();
console.log('\nDone! Banking info imported without touching passwords.');
