const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('./db');
const { auth, adminOnly, JWT_SECRET } = require('./middleware');

const app = express();
app.use(cors());
app.use(express.json());

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/me', auth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role, engineer_id FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

app.put('/api/users/change-password', auth, (req, res) => {
  const { current_password, new_password } = req.body;
  const db = getDb();

  // Get current user
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Verify current password
  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  // Update password
  const hashed = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);

  res.json({ message: 'Password changed successfully' });
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

// Public settings for printing (available to all authenticated users)
app.get('/api/settings/print', auth, (req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('company_name', 'company_logo')").all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

app.get('/api/settings', auth, adminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

app.put('/api/settings', auth, adminOnly, (req, res) => {
  const db = getDb();
  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(req.body)) {
      const existing = db.prepare('SELECT id FROM settings WHERE key = ?').get(key);
      if (existing) {
        update.run(value, key);
      } else {
        insert.run(key, value);
      }
    }
  });
  txn();
  res.json({ success: true });
});

// ─── USERS ───────────────────────────────────────────────────────────────────

app.get('/api/users', auth, adminOnly, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, name, email, role, engineer_id, created_at FROM users ORDER BY name').all();
  res.json(users);
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, email, password, role, engineer_id } = req.body;
  const db = getDb();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (name, email, password, role, engineer_id) VALUES (?, ?, ?, ?, ?)').run(name, email, hash, role || 'engineer', engineer_id || null);
    res.json({ id: result.lastInsertRowid, name, email, role: role || 'engineer' });
  } catch (e) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { name, email, role, engineer_id, password } = req.body;
  const db = getDb();
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, email=?, role=?, engineer_id=?, password=? WHERE id=?').run(name, email, role, engineer_id, hash, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?, email=?, role=?, engineer_id=? WHERE id=?').run(name, email, role, engineer_id, req.params.id);
  }
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────

app.get('/api/customers', auth, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM customers ORDER BY name').all());
});

app.post('/api/customers', auth, adminOnly, (req, res) => {
  const { name, contact, contact_title, email, phone, address, supplier_number, payment_terms } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO customers (name, contact, email, phone, address, supplier_number, payment_terms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, contact, email, phone, address, supplier_number, payment_terms || 'Net 30');
  const customerId = result.lastInsertRowid;

  // Auto-create a contact record if primary contact name is provided
  if (contact && contact.trim()) {
    db.prepare('INSERT INTO customer_contacts (customer_id, name, title, email, phone) VALUES (?, ?, ?, ?, ?)').run(customerId, contact, contact_title || '', email || '', phone || '');
  }

  res.json({ id: customerId, ...req.body });
});

app.put('/api/customers/:id', auth, adminOnly, (req, res) => {
  const { name, contact, email, phone, address, supplier_number, payment_terms } = req.body;
  const db = getDb();
  db.prepare('UPDATE customers SET name=?, contact=?, email=?, phone=?, address=?, supplier_number=?, payment_terms=? WHERE id=?').run(name, contact, email, phone, address, supplier_number, payment_terms || 'Net 30', req.params.id);
  res.json({ success: true });
});

app.delete('/api/customers/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── CUSTOMER CONTACTS ────────────────────────────────────────────────────────

app.get('/api/customers/:id/contacts', auth, (req, res) => {
  const db = getDb();
  const contacts = db.prepare('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY name').all(req.params.id);
  res.json(contacts);
});

app.post('/api/customers/:id/contacts', auth, adminOnly, (req, res) => {
  const { name, title, email, phone } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO customer_contacts (customer_id, name, title, email, phone) VALUES (?, ?, ?, ?, ?)').run(req.params.id, name, title, email, phone);
  res.json({ id: result.lastInsertRowid, customer_id: parseInt(req.params.id), ...req.body });
});

app.put('/api/customers/:customerId/contacts/:id', auth, adminOnly, (req, res) => {
  const { name, title, email, phone } = req.body;
  const db = getDb();
  db.prepare('UPDATE customer_contacts SET name=?, title=?, email=?, phone=? WHERE id=?').run(name, title, email, phone, req.params.id);
  res.json({ success: true });
});

app.delete('/api/customers/:customerId/contacts/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM customer_contacts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── PROJECTS ────────────────────────────────────────────────────────────────

app.get('/api/projects', auth, (req, res) => {
  const db = getDb();
  let projects;
  if (req.user.role === 'admin') {
    projects = db.prepare(`
      SELECT p.*, c.name as customer_name, cc.name as contact_name,
        COALESCE(SUM(te.hours), 0) as hours_used,
        COALESCE(SUM(te.hours * ep.bill_rate), 0) as amount_billed
      FROM projects p
      JOIN customers c ON p.customer_id = c.id
      LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
      LEFT JOIN timesheets ts ON ts.project_id = p.id AND ts.status = 'approved'
      LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
      LEFT JOIN engineer_projects ep ON ep.project_id = p.id AND ep.user_id = ts.user_id
      GROUP BY p.id ORDER BY c.name, p.name
    `).all();
  } else {
    projects = db.prepare(`
      SELECT p.*, c.name as customer_name, cc.name as contact_name, ep.pay_rate, ep.bill_rate
      FROM projects p
      JOIN customers c ON p.customer_id = c.id
      LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
      JOIN engineer_projects ep ON ep.project_id = p.id AND ep.user_id = ?
      WHERE p.status = 'active'
      ORDER BY c.name, p.name
    `).all(req.user.id);
  }
  res.json(projects);
});

app.post('/api/projects', auth, adminOnly, (req, res) => {
  const { customer_id, contact_id, name, description, po_number, po_amount, location, status } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO projects (customer_id, contact_id, name, description, po_number, po_amount, location, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(customer_id, contact_id || null, name, description || null, po_number, po_amount || 0, location, status || 'active');
  res.json({ id: result.lastInsertRowid, ...req.body });
});

app.put('/api/projects/:id', auth, adminOnly, (req, res) => {
  const { customer_id, contact_id, name, description, po_number, po_amount, location, status } = req.body;
  const db = getDb();
  db.prepare('UPDATE projects SET customer_id=?, contact_id=?, name=?, description=?, po_number=?, po_amount=?, location=?, status=? WHERE id=?').run(customer_id, contact_id || null, name, description || null, po_number, po_amount, location, status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/projects/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── ENGINEER PROJECT ASSIGNMENTS ────────────────────────────────────────────

app.get('/api/projects/:id/engineers', auth, adminOnly, (req, res) => {
  const db = getDb();
  const engineers = db.prepare(`
    SELECT ep.*, u.name, u.email, u.engineer_id
    FROM engineer_projects ep
    JOIN users u ON u.id = ep.user_id
    WHERE ep.project_id = ?
  `).all(req.params.id);
  res.json(engineers);
});

app.post('/api/projects/:id/engineers', auth, adminOnly, (req, res) => {
  const { user_id, pay_rate, bill_rate } = req.body;
  const db = getDb();
  try {
    db.prepare('INSERT OR REPLACE INTO engineer_projects (user_id, project_id, pay_rate, bill_rate) VALUES (?, ?, ?, ?)').run(user_id, req.params.id, pay_rate, bill_rate);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/engineers/:userId', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM engineer_projects WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ success: true });
});

// ─── TIMESHEETS ───────────────────────────────────────────────────────────────

app.get('/api/timesheets', auth, (req, res) => {
  const db = getDb();
  const { week_ending, project_id, user_id, status } = req.query;
  let query = `
    SELECT ts.*, u.name as engineer_name, p.name as project_name,
           c.name as customer_name, p.po_number,
           COALESCE(SUM(te.hours), 0) as total_hours,
           ep.pay_rate
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE 1=1
  `;
  const params = [];
  if (req.user.role !== 'admin') { query += ' AND ts.user_id = ?'; params.push(req.user.id); }
  else if (user_id) { query += ' AND ts.user_id = ?'; params.push(user_id); }
  if (week_ending) { query += ' AND ts.week_ending = ?'; params.push(week_ending); }
  if (project_id) { query += ' AND ts.project_id = ?'; params.push(project_id); }
  if (status) { query += ' AND ts.status = ?'; params.push(status); }
  query += ' GROUP BY ts.id ORDER BY ts.week_ending DESC, u.name';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/timesheets/:id', auth, (req, res) => {
  const db = getDb();
  const ts = db.prepare(`
    SELECT ts.*, u.name as engineer_name, u.engineer_id as eng_id,
           p.name as project_name, p.po_number, p.location,
           c.name as customer_name, ep.bill_rate, ep.pay_rate
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.id = ?
  `).get(req.params.id);
  if (!ts) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ts.user_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? ORDER BY entry_date').all(req.params.id);
  res.json({ ...ts, entries });
});

app.post('/api/timesheets', auth, (req, res) => {
  const { project_id, week_ending } = req.body;
  const user_id = req.user.role === 'admin' && req.body.user_id ? req.body.user_id : req.user.id;
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO timesheets (user_id, project_id, week_ending) VALUES (?, ?, ?)').run(user_id, project_id, week_ending);
    // Auto-create 7 entries for the week (Sun through Sat based on week_ending Sunday)
    const weekEnd = new Date(week_ending + 'T00:00:00');
    const insertEntry = db.prepare('INSERT INTO timesheet_entries (timesheet_id, entry_date) VALUES (?, ?)');
    for (let i = 6; i >= 0; i--) {
      const d = new Date(weekEnd);
      d.setDate(d.getDate() - i);
      insertEntry.run(result.lastInsertRowid, d.toISOString().split('T')[0]);
    }
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Timesheet already exists for this week/project' });
  }
});

app.put('/api/timesheets/:id/entries', auth, (req, res) => {
  const { entries } = req.body;
  const db = getDb();
  const ts = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(req.params.id);
  if (!ts) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ts.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (ts.status === 'approved') return res.status(400).json({ error: 'Cannot edit approved timesheet' });

  const update = db.prepare('UPDATE timesheet_entries SET start_time=?, end_time=?, hours=?, description=?, shift=? WHERE id=?');
  const txn = db.transaction(() => {
    for (const e of entries) {
      let hours = 0;
      if (e.start_time && e.end_time) {
        const [sh, sm] = e.start_time.split(':').map(Number);
        const [eh, em] = e.end_time.split(':').map(Number);
        hours = (eh * 60 + em - sh * 60 - sm) / 60;
        if (hours < 0) hours += 24;
      }
      update.run(e.start_time || null, e.end_time || null, hours, e.description || null, e.shift || 1, e.id);
    }
  });
  txn();
  res.json({ success: true });
});

app.put('/api/timesheets/:id/submit', auth, (req, res) => {
  const db = getDb();
  const ts = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(req.params.id);
  if (!ts) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ts.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE timesheets SET status='submitted', submitted_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

app.put('/api/timesheets/:id/approve', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare("UPDATE timesheets SET status='approved', approved_at=CURRENT_TIMESTAMP, approved_by=? WHERE id=?").run(req.user.id, req.params.id);
  res.json({ success: true });
});

app.put('/api/timesheets/:id/reject', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare("UPDATE timesheets SET status='draft' WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/timesheets/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  // Delete entries first, then the timesheet
  db.prepare('DELETE FROM timesheet_entries WHERE timesheet_id = ?').run(req.params.id);
  db.prepare('DELETE FROM timesheets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── INVOICES ────────────────────────────────────────────────────────────────

app.get('/api/invoices', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoices = db.prepare(`
    SELECT i.*, p.name as project_name, p.po_number, c.name as customer_name,
           c.supplier_number, c.address as customer_address, c.payment_terms, cc.name as contact_name
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(invoices);
});

app.get('/api/invoices/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*, p.name as project_name, p.description as project_description, p.po_number, p.location,
           c.name as customer_name, c.address as customer_address, c.supplier_number, c.payment_terms,
           cc.name as contact_name
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  // Get company settings
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  // Get line items from approved timesheets in the period
  const timesheets = db.prepare(`
    SELECT ts.*, u.name as engineer_name, u.engineer_id, ep.bill_rate
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.project_id = ? AND ts.status = 'approved'
    AND ts.week_ending BETWEEN ? AND ?
  `).all(invoice.project_id, invoice.period_start, invoice.period_end);

  const lineItems = [];
  const timesheetDetails = [];
  for (const ts of timesheets) {
    const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? ORDER BY entry_date').all(ts.id);
    const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
    if (hrs > 0) {
      lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.bill_rate || 0, amount: hrs * (ts.bill_rate || 0) });
      // Include full timesheet details for printing
      timesheetDetails.push({
        id: ts.id,
        engineer_name: ts.engineer_name,
        engineer_id: ts.engineer_id,
        week_ending: ts.week_ending,
        bill_rate: ts.bill_rate,
        total_hours: hrs,
        entries: entries.map(e => ({
          entry_date: e.entry_date,
          start_time: e.start_time,
          end_time: e.end_time,
          hours: e.hours,
          shift: e.shift,
          description: e.description
        }))
      });
    }
  }

  res.json({ ...invoice, settings, lineItems, timesheetDetails });
});

app.delete('/api/invoices/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/invoices/generate', auth, adminOnly, (req, res) => {
  try {
    const { project_id, period_start, period_end, notes } = req.body;
    const db = getDb();

    const timesheets = db.prepare(`
      SELECT ts.*, u.name as engineer_name, u.engineer_id, ep.bill_rate, ep.pay_rate
      FROM timesheets ts
      JOIN users u ON u.id = ts.user_id
      LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
      WHERE ts.project_id = ? AND ts.status = 'approved'
      AND ts.week_ending BETWEEN ? AND ?
    `).all(project_id, period_start, period_end);

    let total_hours = 0, total_amount = 0;
    const lineItems = [];
    const timesheetDetails = [];

    for (const ts of timesheets) {
      const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? ORDER BY entry_date').all(ts.id);
      const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
      const amt = hrs * (ts.bill_rate || 0);
      total_hours += hrs;
      total_amount += amt;
      if (hrs > 0) {
        lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.bill_rate, amount: amt });
        timesheetDetails.push({
          id: ts.id,
          engineer_name: ts.engineer_name,
          engineer_id: ts.engineer_id,
          week_ending: ts.week_ending,
          bill_rate: ts.bill_rate,
          total_hours: hrs,
          entries: entries.map(e => ({
            entry_date: e.entry_date,
            start_time: e.start_time,
            end_time: e.end_time,
            hours: e.hours,
            shift: e.shift,
            description: e.description
          }))
        });
      }
    }

    // Get next invoice number from settings and increment
    const nextNumRow = db.prepare("SELECT value FROM settings WHERE key = 'next_invoice_number'").get();
    const nextNum = parseInt(nextNumRow?.value || '1000');
    const invoice_number = String(nextNum);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('next_invoice_number', ?)").run(String(nextNum + 1));

    const result = db.prepare('INSERT INTO invoices (project_id, invoice_number, period_start, period_end, total_hours, total_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(project_id, invoice_number, period_start, period_end, total_hours, total_amount, notes);

    // Get full project and customer info
    const project = db.prepare(`
      SELECT p.*, p.description as project_description, c.name as customer_name, c.address as customer_address,
             c.supplier_number, c.payment_terms, cc.name as contact_name
      FROM projects p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
      WHERE p.id = ?
    `).get(project_id);

    // Get company settings
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }

    res.json({ id: result.lastInsertRowid, invoice_number, project, settings, total_hours, total_amount, lineItems, timesheetDetails, period_start, period_end });
  } catch (err) {
    console.error('Invoice generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PAYMENTS & BALANCES ─────────────────────────────────────────────────────

// Record a payment on an invoice
app.post('/api/invoices/:id/payments', auth, adminOnly, (req, res) => {
  const { amount, payment_date, payment_method, reference_number, notes } = req.body;
  const db = getDb();

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'voided') return res.status(400).json({ error: 'Cannot add payment to voided invoice' });

  // Add the payment
  db.prepare('INSERT INTO payments (invoice_id, amount, payment_date, payment_method, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, amount, payment_date, payment_method || null, reference_number || null, notes || null);

  // Update invoice amount_paid and status
  const newAmountPaid = (invoice.amount_paid || 0) + amount;
  let newStatus = 'partial';
  let paidDate = null;

  if (newAmountPaid >= invoice.total_amount) {
    newStatus = 'paid';
    paidDate = payment_date;
  } else if (newAmountPaid <= 0) {
    newStatus = 'unpaid';
  }

  db.prepare('UPDATE invoices SET amount_paid = ?, status = ?, paid_date = ? WHERE id = ?')
    .run(newAmountPaid, newStatus, paidDate, req.params.id);

  res.json({ success: true, amount_paid: newAmountPaid, status: newStatus });
});

// Get payments for an invoice
app.get('/api/invoices/:id/payments', auth, adminOnly, (req, res) => {
  const db = getDb();
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC').all(req.params.id);
  res.json(payments);
});

// Delete a payment
app.delete('/api/payments/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id);

  // Delete the payment
  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);

  // Recalculate invoice amount_paid
  const totalPayments = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE invoice_id = ?').get(payment.invoice_id);
  const newAmountPaid = totalPayments.total;

  let newStatus = 'unpaid';
  let paidDate = null;
  if (newAmountPaid >= invoice.total_amount) {
    newStatus = 'paid';
    // Get the latest payment date
    const lastPayment = db.prepare('SELECT payment_date FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC LIMIT 1').get(payment.invoice_id);
    paidDate = lastPayment?.payment_date || null;
  } else if (newAmountPaid > 0) {
    newStatus = 'partial';
  }

  db.prepare('UPDATE invoices SET amount_paid = ?, status = ?, paid_date = ? WHERE id = ?')
    .run(newAmountPaid, newStatus, paidDate, payment.invoice_id);

  res.json({ success: true });
});

// Void an invoice
app.put('/api/invoices/:id/void', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const today = new Date().toISOString().split('T')[0];
  db.prepare('UPDATE invoices SET status = ?, voided_date = ? WHERE id = ?').run('voided', today, req.params.id);
  res.json({ success: true });
});

// Unvoid an invoice (restore to previous state)
app.put('/api/invoices/:id/unvoid', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'voided') return res.status(400).json({ error: 'Invoice is not voided' });

  // Determine status based on payments
  let newStatus = 'unpaid';
  if (invoice.amount_paid >= invoice.total_amount) {
    newStatus = 'paid';
  } else if (invoice.amount_paid > 0) {
    newStatus = 'partial';
  }

  db.prepare('UPDATE invoices SET status = ?, voided_date = NULL WHERE id = ?').run(newStatus, req.params.id);
  res.json({ success: true });
});

// Get outstanding balances summary
app.get('/api/balances', auth, adminOnly, (req, res) => {
  const db = getDb();

  // Total outstanding
  const totalOutstanding = db.prepare(`
    SELECT COALESCE(SUM(total_amount - amount_paid), 0) as total
    FROM invoices WHERE status IN ('unpaid', 'partial')
  `).get();

  // By customer
  const byCustomer = db.prepare(`
    SELECT c.id, c.name,
           COUNT(i.id) as invoice_count,
           COALESCE(SUM(i.total_amount), 0) as total_invoiced,
           COALESCE(SUM(i.amount_paid), 0) as total_paid,
           COALESCE(SUM(i.total_amount - i.amount_paid), 0) as outstanding
    FROM customers c
    LEFT JOIN projects p ON p.customer_id = c.id
    LEFT JOIN invoices i ON i.project_id = p.id AND i.status IN ('unpaid', 'partial')
    GROUP BY c.id
    HAVING outstanding > 0
    ORDER BY outstanding DESC
  `).all();

  // By project
  const byProject = db.prepare(`
    SELECT p.id, p.name as project_name, c.name as customer_name,
           COUNT(i.id) as invoice_count,
           COALESCE(SUM(i.total_amount), 0) as total_invoiced,
           COALESCE(SUM(i.amount_paid), 0) as total_paid,
           COALESCE(SUM(i.total_amount - i.amount_paid), 0) as outstanding
    FROM projects p
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN invoices i ON i.project_id = p.id AND i.status IN ('unpaid', 'partial')
    GROUP BY p.id
    HAVING outstanding > 0
    ORDER BY outstanding DESC
  `).all();

  res.json({
    total_outstanding: totalOutstanding.total,
    by_customer: byCustomer,
    by_project: byProject
  });
});

// ─── REPORTS ─────────────────────────────────────────────────────────────────

app.get('/api/reports/payroll', auth, adminOnly, (req, res) => {
  const { period_start, period_end } = req.query;
  const db = getDb();
  const data = db.prepare(`
    SELECT u.name as engineer_name, u.engineer_id,
           SUM(te.hours) as total_hours,
           ep.pay_rate,
           SUM(te.hours) * ep.pay_rate as total_pay,
           ep.bill_rate,
           SUM(te.hours) * ep.bill_rate as total_billed,
           p.name as project_name, p.po_number
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.status = 'approved' AND ts.week_ending BETWEEN ? AND ?
    GROUP BY u.id, p.id
    ORDER BY u.name, p.name
  `).all(period_start, period_end);
  res.json(data);
});

// Engineer earnings report (accessible by engineers for their own data)
app.get('/api/reports/my-earnings', auth, (req, res) => {
  const db = getDb();
  const { year } = req.query;
  const targetYear = year || new Date().getFullYear();
  const yearStart = `${targetYear}-01-01`;
  const yearEnd = `${targetYear}-12-31`;

  // Get all approved timesheets for this engineer in the year
  const timesheets = db.prepare(`
    SELECT ts.id, ts.week_ending, ts.status,
           p.name as project_name, c.name as customer_name,
           COALESCE(SUM(te.hours), 0) as total_hours,
           ep.pay_rate,
           COALESCE(SUM(te.hours), 0) * COALESCE(ep.pay_rate, 0) as amount
    FROM timesheets ts
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.user_id = ? AND ts.week_ending BETWEEN ? AND ?
    GROUP BY ts.id
    ORDER BY ts.week_ending DESC
  `).all(req.user.id, yearStart, yearEnd);

  // Calculate totals
  const approvedSheets = timesheets.filter(t => t.status === 'approved');
  const totalHours = approvedSheets.reduce((s, t) => s + (t.total_hours || 0), 0);
  const totalEarnings = approvedSheets.reduce((s, t) => s + (t.amount || 0), 0);
  const pendingHours = timesheets.filter(t => t.status !== 'approved').reduce((s, t) => s + (t.total_hours || 0), 0);
  const pendingAmount = timesheets.filter(t => t.status !== 'approved').reduce((s, t) => s + (t.amount || 0), 0);

  res.json({
    year: targetYear,
    timesheets,
    summary: {
      total_hours: totalHours,
      total_earnings: totalEarnings,
      pending_hours: pendingHours,
      pending_amount: pendingAmount
    }
  });
});

app.get('/api/reports/project-budget', auth, adminOnly, (req, res) => {
  const db = getDb();
  const data = db.prepare(`
    SELECT p.id, p.name as project_name, p.po_number, p.po_amount, c.name as customer_name,
           COALESCE(SUM(te.hours), 0) as total_hours,
           COALESCE(SUM(te.hours * ep.bill_rate), 0) as amount_billed,
           p.po_amount - COALESCE(SUM(te.hours * ep.bill_rate), 0) as remaining
    FROM projects p
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN timesheets ts ON ts.project_id = p.id AND ts.status = 'approved'
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    LEFT JOIN engineer_projects ep ON ep.project_id = p.id AND ep.user_id = ts.user_id
    GROUP BY p.id
    ORDER BY c.name, p.name
  `).all();
  res.json(data);
});

// Catch-all: serve React app for any non-API routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
