/**
 * Import engineers from CSV file
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

// Use /data if it exists (same as server)
let DATA_DIR = __dirname;
if (fs.existsSync('/data')) {
  DATA_DIR = '/data';
  console.log('Using persistent disk at /data');
}
const DB_PATH = path.join(DATA_DIR, 'timetracker.db');
const CSV_FILE = path.join(__dirname, '..', '..', '..', 'Engineers.csv');

console.log('Reading CSV:', CSV_FILE);
const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
const lines = csvContent.trim().split('\n').filter(l => l.trim());

const db = new Database(DB_PATH);
const insertUser = db.prepare('INSERT INTO users (name, email, password, role, engineer_id) VALUES (?, ?, ?, ?, ?)');
const checkUser = db.prepare('SELECT id FROM users WHERE email = ?');

console.log('Importing ' + lines.length + ' engineers...\n');

for (const line of lines) {
  const parts = line.split(',');
  const name = parts[0]?.trim();
  const email = parts[1]?.trim();
  const engineerId = parts[2]?.trim();
  const password = parts[3]?.trim() || 'Password123';

  if (!name || !email) continue;

  // Check if user exists
  const existing = checkUser.get(email);
  if (existing) {
    console.log('  Skipping existing:', name);
    continue;
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = insertUser.run(name, email, hash, 'engineer', engineerId || null);
    console.log('  Imported:', name, '(' + email + ')');
  } catch (err) {
    console.error('  Error importing', name + ':', err.message);
  }
}

db.close();
console.log('\n--- Import Complete ---');
