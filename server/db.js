const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Use persistent disk in production if available
let DATA_DIR = __dirname;

// Check for Render persistent disk
if (fs.existsSync('/data')) {
  DATA_DIR = '/data';
  console.log('✅ Persistent disk found at /data');
} else {
  console.log('⚠️ No persistent disk at /data, using local directory');
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
}

const DB_PATH = path.join(DATA_DIR, 'timetracker.db');
console.log(`📁 Database location: ${DB_PATH}`);

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'engineer',
      engineer_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      supplier_number TEXT,
      payment_terms TEXT DEFAULT 'Net 30',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      title TEXT,
      email TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      contact_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      po_number TEXT,
      po_amount REAL DEFAULT 0,
      location TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (contact_id) REFERENCES customer_contacts(id)
    );

    CREATE TABLE IF NOT EXISTS engineer_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      pay_rate REAL DEFAULT 0,
      bill_rate REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS timesheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      week_ending DATE NOT NULL,
      status TEXT DEFAULT 'draft',
      submitted_at DATETIME,
      approved_at DATETIME,
      approved_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, project_id, week_ending),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS timesheet_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timesheet_id INTEGER NOT NULL,
      entry_date DATE NOT NULL,
      start_time TEXT,
      end_time TEXT,
      hours REAL DEFAULT 0,
      description TEXT,
      shift INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      invoice_number TEXT UNIQUE NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      total_hours REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      amount_paid REAL DEFAULT 0,
      status TEXT DEFAULT 'unpaid',
      paid_date DATE,
      voided_date DATE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date DATE NOT NULL,
      payment_method TEXT,
      reference_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
  `);

  // Run migrations for existing databases
  // Add description column to projects if missing
  const projectCols = db.prepare("PRAGMA table_info(projects)").all();
  if (!projectCols.find(c => c.name === 'description')) {
    db.exec('ALTER TABLE projects ADD COLUMN description TEXT');
    console.log('✅ Migration: Added description column to projects');
  }
  // Add contact_id column to projects if missing
  if (!projectCols.find(c => c.name === 'contact_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN contact_id INTEGER');
    console.log('✅ Migration: Added contact_id column to projects');
  }
  // Add payment_terms column to customers if missing
  const customerCols = db.prepare("PRAGMA table_info(customers)").all();
  if (!customerCols.find(c => c.name === 'payment_terms')) {
    db.exec("ALTER TABLE customers ADD COLUMN payment_terms TEXT DEFAULT 'Net 30'");
    console.log('✅ Migration: Added payment_terms column to customers');
  }
  // Add ap_email column to customers if missing
  if (!customerCols.find(c => c.name === 'ap_email')) {
    db.exec('ALTER TABLE customers ADD COLUMN ap_email TEXT');
    console.log('✅ Migration: Added ap_email column to customers');
  }

  // Add include_timesheets column to projects if missing
  const projectCols2 = db.prepare("PRAGMA table_info(projects)").all();
  if (!projectCols2.find(c => c.name === 'include_timesheets')) {
    db.exec('ALTER TABLE projects ADD COLUMN include_timesheets INTEGER DEFAULT 1');
    console.log('✅ Migration: Added include_timesheets column to projects');
  }

  // Add payment tracking columns to invoices if missing
  const invoiceCols = db.prepare("PRAGMA table_info(invoices)").all();
  if (!invoiceCols.find(c => c.name === 'amount_paid')) {
    db.exec('ALTER TABLE invoices ADD COLUMN amount_paid REAL DEFAULT 0');
    console.log('✅ Migration: Added amount_paid column to invoices');
  }
  if (!invoiceCols.find(c => c.name === 'paid_date')) {
    db.exec('ALTER TABLE invoices ADD COLUMN paid_date DATE');
    console.log('✅ Migration: Added paid_date column to invoices');
  }
  if (!invoiceCols.find(c => c.name === 'voided_date')) {
    db.exec('ALTER TABLE invoices ADD COLUMN voided_date DATE');
    console.log('✅ Migration: Added voided_date column to invoices');
  }
  // Update existing invoices with 'draft' status to 'unpaid'
  db.exec("UPDATE invoices SET status = 'unpaid' WHERE status = 'draft'");

  // Create payments table if not exists (for existing databases)
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date DATE NOT NULL,
      payment_method TEXT,
      reference_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )
  `);

  // Seed admin user if none exists
  const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`)
      .run('Admin', 'admin@company.com', hash, 'admin');
    console.log('✅ Default admin created: admin@company.com / admin123');
  }

  // Seed default settings if none exist
  const settingsExist = db.prepare('SELECT id FROM settings LIMIT 1').get();
  if (!settingsExist) {
    const defaultSettings = [
      ['company_name', ''],
      ['company_address', ''],
      ['company_city_state_zip', ''],
      ['company_phone', ''],
      ['company_fax', ''],
      ['company_email', ''],
      ['company_logo', ''],
      ['next_invoice_number', '1000'],
    ];
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of defaultSettings) {
      insert.run(key, value);
    }
    console.log('✅ Default settings created');
  }
}

module.exports = { getDb };
