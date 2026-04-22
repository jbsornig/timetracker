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

const DB_NAME = process.env.DB_NAME || 'timetracker.db';
const DB_PATH = path.join(DATA_DIR, DB_NAME);
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
console.log(`📁 Database location: ${DB_PATH}`);

let db;

function backupDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.log('No database to backup yet');
      return;
    }
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `timetracker-${timestamp}.db`);

    // Use VACUUM INTO to create a complete standalone backup (includes all WAL data)
    if (db) {
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    } else {
      // Fallback: if no active connection, just copy the file
      fs.copyFileSync(DB_PATH, backupPath);
    }
    console.log(`✅ Database backup created: ${backupPath}`);

    // Keep only the 10 most recent backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('timetracker-') && f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm'))
      .sort()
      .reverse();
    for (const old of backups.slice(10)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
      // Clean up associated WAL/SHM files if any
      const walPath = path.join(BACKUP_DIR, old + '-wal');
      const shmPath = path.join(BACKUP_DIR, old + '-shm');
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    }
  } catch (err) {
    console.error('⚠️ Database backup failed:', err.message);
  }
}

function getDb() {
  if (!db) {
    // ALWAYS backup before any schema initialization/migration
    backupDatabase();
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

  // Add emailed_at column to invoices if missing
  const invoiceCols2 = db.prepare("PRAGMA table_info(invoices)").all();
  if (!invoiceCols2.find(c => c.name === 'emailed_at')) {
    db.exec('ALTER TABLE invoices ADD COLUMN emailed_at DATETIME');
    console.log('✅ Migration: Added emailed_at column to invoices');
  }

  // Add received_at column to invoices if missing (customer acknowledged receipt)
  const invoiceCols3 = db.prepare("PRAGMA table_info(invoices)").all();
  if (!invoiceCols3.find(c => c.name === 'received_at')) {
    db.exec('ALTER TABLE invoices ADD COLUMN received_at DATETIME');
    console.log('✅ Migration: Added received_at column to invoices');
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

  // Create holidays table for holiday pay tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date DATE NOT NULL,
      hours REAL DEFAULT 8,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add holiday pay columns to users if missing
  const userCols = db.prepare("PRAGMA table_info(users)").all();
  if (!userCols.find(c => c.name === 'holiday_pay_eligible')) {
    db.exec('ALTER TABLE users ADD COLUMN holiday_pay_eligible INTEGER DEFAULT 0');
    console.log('✅ Migration: Added holiday_pay_eligible column to users');
  }
  if (!userCols.find(c => c.name === 'holiday_pay_rate')) {
    db.exec('ALTER TABLE users ADD COLUMN holiday_pay_rate REAL DEFAULT 0');
    console.log('✅ Migration: Added holiday_pay_rate column to users');
  }
  if (!userCols.find(c => c.name === 'last_login')) {
    db.exec('ALTER TABLE users ADD COLUMN last_login DATETIME');
    console.log('✅ Migration: Added last_login column to users');
  }
  // Add banking fields for ACH payments (primary account)
  if (!userCols.find(c => c.name === 'bank_routing')) {
    db.exec('ALTER TABLE users ADD COLUMN bank_routing TEXT');
    console.log('✅ Migration: Added bank_routing column to users');
  }
  if (!userCols.find(c => c.name === 'bank_account')) {
    db.exec('ALTER TABLE users ADD COLUMN bank_account TEXT');
    console.log('✅ Migration: Added bank_account column to users');
  }
  if (!userCols.find(c => c.name === 'bank_account_type')) {
    db.exec("ALTER TABLE users ADD COLUMN bank_account_type TEXT DEFAULT 'checking'");
    console.log('✅ Migration: Added bank_account_type column to users');
  }
  // Add split deposit fields (secondary account)
  if (!userCols.find(c => c.name === 'bank_routing_2')) {
    db.exec('ALTER TABLE users ADD COLUMN bank_routing_2 TEXT');
    console.log('✅ Migration: Added bank_routing_2 column to users');
  }
  if (!userCols.find(c => c.name === 'bank_account_2')) {
    db.exec('ALTER TABLE users ADD COLUMN bank_account_2 TEXT');
    console.log('✅ Migration: Added bank_account_2 column to users');
  }
  if (!userCols.find(c => c.name === 'bank_account_type_2')) {
    db.exec("ALTER TABLE users ADD COLUMN bank_account_type_2 TEXT DEFAULT 'checking'");
    console.log('✅ Migration: Added bank_account_type_2 column to users');
  }
  if (!userCols.find(c => c.name === 'bank_pct_1')) {
    db.exec('ALTER TABLE users ADD COLUMN bank_pct_1 INTEGER DEFAULT 100');
    console.log('✅ Migration: Added bank_pct_1 column to users');
  }
  if (!userCols.find(c => c.name === 'bank_pct_2')) {
    db.exec('ALTER TABLE users ADD COLUMN bank_pct_2 INTEGER DEFAULT 0');
    console.log('✅ Migration: Added bank_pct_2 column to users');
  }

  // Add pay delay column for engineers paid one month behind
  if (!userCols.find(c => c.name === 'pay_delay_months')) {
    db.exec('ALTER TABLE users ADD COLUMN pay_delay_months INTEGER DEFAULT 0');
    console.log('✅ Migration: Added pay_delay_months column to users');
  }

  // Add fixed price project columns
  const projectCols3 = db.prepare("PRAGMA table_info(projects)").all();
  if (!projectCols3.find(c => c.name === 'project_type')) {
    db.exec("ALTER TABLE projects ADD COLUMN project_type TEXT DEFAULT 'hourly'");
    console.log('✅ Migration: Added project_type column to projects');
  }
  if (!projectCols3.find(c => c.name === 'total_cost')) {
    db.exec('ALTER TABLE projects ADD COLUMN total_cost REAL DEFAULT 0');
    console.log('✅ Migration: Added total_cost column to projects');
  }
  if (!projectCols3.find(c => c.name === 'requires_daily_logs')) {
    db.exec('ALTER TABLE projects ADD COLUMN requires_daily_logs INTEGER DEFAULT 1');
    console.log('✅ Migration: Added requires_daily_logs column to projects');
  }

  // Add total_payment column to engineer_projects for fixed price projects
  const epCols = db.prepare("PRAGMA table_info(engineer_projects)").all();
  if (!epCols.find(c => c.name === 'total_payment')) {
    db.exec('ALTER TABLE engineer_projects ADD COLUMN total_payment REAL DEFAULT 0');
    console.log('✅ Migration: Added total_payment column to engineer_projects');
  }

  // Add monthly_pay and monthly_bill columns for fixed_monthly projects
  if (!epCols.find(c => c.name === 'monthly_pay')) {
    db.exec('ALTER TABLE engineer_projects ADD COLUMN monthly_pay REAL DEFAULT 0');
    console.log('✅ Migration: Added monthly_pay column to engineer_projects');
  }
  if (!epCols.find(c => c.name === 'monthly_bill')) {
    db.exec('ALTER TABLE engineer_projects ADD COLUMN monthly_bill REAL DEFAULT 0');
    console.log('✅ Migration: Added monthly_bill column to engineer_projects');
  }

  // Add fixed price timesheet columns
  const tsCols = db.prepare("PRAGMA table_info(timesheets)").all();
  if (!tsCols.find(c => c.name === 'period_start')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN period_start DATE');
    console.log('✅ Migration: Added period_start column to timesheets');
  }
  if (!tsCols.find(c => c.name === 'period_end')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN period_end DATE');
    console.log('✅ Migration: Added period_end column to timesheets');
  }
  if (!tsCols.find(c => c.name === 'percentage')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN percentage INTEGER DEFAULT 0');
    console.log('✅ Migration: Added percentage column to timesheets');
  }
  if (!tsCols.find(c => c.name === 'amount')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN amount REAL DEFAULT 0');
    console.log('✅ Migration: Added amount column to timesheets');
  }

  // Add lunch_break column to timesheet_entries if missing
  const teCols = db.prepare("PRAGMA table_info(timesheet_entries)").all();
  if (!teCols.find(c => c.name === 'lunch_break')) {
    db.exec('ALTER TABLE timesheet_entries ADD COLUMN lunch_break REAL DEFAULT 0');
    console.log('✅ Migration: Added lunch_break column to timesheet_entries');
  }

  // Remove UNIQUE constraint on timesheets (user_id, project_id, week_ending)
  // to allow multiple timesheets for the same week when it spans two months.
  // SQLite autoindexes from inline UNIQUE can't be dropped, so recreate the table.
  try {
    const hasUniqueConstraint = db.prepare("PRAGMA index_list('timesheets')").all()
      .some(idx => {
        if (!idx.unique) return false;
        const cols = db.prepare(`PRAGMA index_info("${idx.name}")`).all();
        const colNames = cols.map(c => c.name).sort().join(',');
        return colNames === 'project_id,user_id,week_ending';
      });
    if (hasUniqueConstraint) {
      // Disable foreign keys to prevent CASCADE deleting timesheet_entries
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE timesheets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          project_id INTEGER NOT NULL,
          week_ending DATE NOT NULL,
          status TEXT DEFAULT 'draft',
          submitted_at DATETIME,
          approved_at DATETIME,
          approved_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          period_start DATE,
          period_end DATE,
          percentage INTEGER DEFAULT 0,
          amount REAL DEFAULT 0,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );
        INSERT INTO timesheets_new SELECT id, user_id, project_id, week_ending, status, submitted_at, approved_at, approved_by, created_at, period_start, period_end, percentage, amount FROM timesheets;
        DROP TABLE timesheets;
        ALTER TABLE timesheets_new RENAME TO timesheets;
      `);
      db.pragma('foreign_keys = ON');
      console.log('✅ Migration: Recreated timesheets table without UNIQUE constraint');
    }
  } catch (e) {
    console.log('Note: timesheets UNIQUE migration error:', e.message);
  }

  // Re-check timesheet columns after table recreation (safety net)
  const tsColsAfter = db.prepare("PRAGMA table_info(timesheets)").all();
  if (!tsColsAfter.find(c => c.name === 'period_start')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN period_start DATE');
    console.log('✅ Migration: Added period_start column to timesheets (post-recreation)');
  }
  if (!tsColsAfter.find(c => c.name === 'period_end')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN period_end DATE');
    console.log('✅ Migration: Added period_end column to timesheets (post-recreation)');
  }
  if (!tsColsAfter.find(c => c.name === 'percentage')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN percentage INTEGER DEFAULT 0');
    console.log('✅ Migration: Added percentage column to timesheets (post-recreation)');
  }
  if (!tsColsAfter.find(c => c.name === 'amount')) {
    db.exec('ALTER TABLE timesheets ADD COLUMN amount REAL DEFAULT 0');
    console.log('✅ Migration: Added amount column to timesheets (post-recreation)');
  }

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
      ['chase_ach_account', ''],
    ];
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of defaultSettings) {
      insert.run(key, value);
    }
    console.log('✅ Default settings created');
  }

  // Add chase_ach_account setting if missing (for existing databases)
  const chaseAchExists = db.prepare("SELECT id FROM settings WHERE key = 'chase_ach_account'").get();
  if (!chaseAchExists) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('chase_ach_account', '')").run();
    console.log('✅ Migration: Added chase_ach_account setting');
  }

  // Create engineer_payments table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS engineer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date DATE NOT NULL,
      payment_type TEXT NOT NULL DEFAULT 'payroll',
      period_start DATE,
      period_end DATE,
      reference_number TEXT,
      payment_method TEXT DEFAULT 'ACH',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Add cleared columns to engineer_payments for advance tracking
  try {
    db.exec("ALTER TABLE engineer_payments ADD COLUMN cleared INTEGER DEFAULT 0");
    console.log('✅ Migration: Added cleared column to engineer_payments');
  } catch (e) { /* column already exists */ }
  try {
    db.exec("ALTER TABLE engineer_payments ADD COLUMN cleared_payroll_period TEXT");
    console.log('✅ Migration: Added cleared_payroll_period column to engineer_payments');
  } catch (e) { /* column already exists */ }

  // Add invoice_id to timesheet_entries for tracking which entries have been invoiced
  try {
    db.exec("ALTER TABLE timesheet_entries ADD COLUMN invoice_id INTEGER REFERENCES invoices(id)");
    console.log('✅ Migration: Added invoice_id column to timesheet_entries');
  } catch (e) { /* column already exists */ }

  // Add invoice_id to timesheets for fixed-price project invoice tracking
  try {
    db.exec("ALTER TABLE timesheets ADD COLUMN invoice_id INTEGER REFERENCES invoices(id)");
    console.log('✅ Migration: Added invoice_id column to timesheets');
  } catch (e) { /* column already exists */ }

  // One-time backfill: stamp existing timesheet entries/timesheets with their invoice_id
  const hasAnyStamps = db.prepare('SELECT COUNT(*) as cnt FROM timesheet_entries WHERE invoice_id IS NOT NULL').get();
  if (hasAnyStamps.cnt === 0) {
    console.log('🔄 Running one-time invoice backfill...');
    const invoices = db.prepare(`
      SELECT i.id, i.project_id, i.period_start, i.period_end, p.project_type
      FROM invoices i
      JOIN projects p ON p.id = i.project_id
      WHERE i.voided_date IS NULL
      ORDER BY i.period_start
    `).all();

    let entryCount = 0;
    let tsCount = 0;

    const backfillTxn = db.transaction(() => {
      for (const inv of invoices) {
        if (inv.project_type === 'fixed_price') {
          const result = db.prepare(`
            UPDATE timesheets SET invoice_id = ?
            WHERE project_id = ? AND status = 'approved' AND invoice_id IS NULL
            AND (week_ending BETWEEN ? AND ? OR (period_end IS NOT NULL AND period_end BETWEEN ? AND ?))
          `).run(inv.id, inv.project_id, inv.period_start, inv.period_end, inv.period_start, inv.period_end);
          tsCount += result.changes;
        } else {
          const result = db.prepare(`
            UPDATE timesheet_entries SET invoice_id = ?
            WHERE timesheet_id IN (
              SELECT ts.id FROM timesheets ts
              WHERE ts.project_id = ? AND ts.status = 'approved'
            )
            AND entry_date BETWEEN ? AND ? AND invoice_id IS NULL
          `).run(inv.id, inv.project_id, inv.period_start, inv.period_end);
          entryCount += result.changes;
        }
      }
    });

    backfillTxn();
    console.log(`✅ Backfill complete: ${entryCount} entries stamped, ${tsCount} timesheets stamped`);
  }
}

function replaceDatabase(newDbPath) {
  // Checkpoint and close existing connection so WAL is flushed
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { console.log('Checkpoint warning:', e.message); }
    db.close();
    db = null;
  }
  // Remove WAL/SHM BEFORE replacing the main file
  if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');
  if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
  // Replace the database file
  fs.copyFileSync(newDbPath, DB_PATH);
  // Open the new database directly (skip the auto-backup in getDb)
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema();
  console.log('✅ Database replaced and reopened from:', newDbPath);
  return db;
}

module.exports = { getDb, backupDatabase, replaceDatabase, BACKUP_DIR };
