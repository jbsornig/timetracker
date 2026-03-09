const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { getDb } = require('./db');
const { auth, adminOnly, JWT_SECRET } = require('./middleware');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── EMAIL HELPER ─────────────────────────────────────────────────────────────

async function sendNotificationEmail(subject, htmlBody) {
  const db = getDb();
  const settings = {};
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('smtp_email', 'smtp_password', 'admin_notification_email')").all();
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  if (!settings.smtp_email || !settings.smtp_password || !settings.admin_notification_email) {
    console.log('Email notifications not configured - skipping');
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: settings.smtp_email,
        pass: settings.smtp_password,
      },
    });

    await transporter.sendMail({
      from: settings.smtp_email,
      to: settings.admin_notification_email,
      subject: subject,
      html: htmlBody,
    });
    console.log('Notification email sent successfully');
  } catch (err) {
    console.error('Failed to send notification email:', err.message);
  }
}

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

// ─── HOLIDAYS ─────────────────────────────────────────────────────────────────

app.get('/api/holidays', auth, adminOnly, (req, res) => {
  const db = getDb();
  const { year } = req.query;
  let query = 'SELECT * FROM holidays';
  const params = [];
  if (year) {
    query += " WHERE strftime('%Y', date) = ?";
    params.push(year);
  }
  query += ' ORDER BY date DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/holidays', auth, adminOnly, (req, res) => {
  const { name, date, hours } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO holidays (name, date, hours) VALUES (?, ?, ?)').run(name, date, hours || 8);
  res.json({ id: result.lastInsertRowid, name, date, hours: hours || 8 });
});

app.put('/api/holidays/:id', auth, adminOnly, (req, res) => {
  const { name, date, hours } = req.body;
  const db = getDb();
  db.prepare('UPDATE holidays SET name=?, date=?, hours=? WHERE id=?').run(name, date, hours, req.params.id);
  res.json({ success: true });
});

app.delete('/api/holidays/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── USERS ───────────────────────────────────────────────────────────────────

app.get('/api/users', auth, adminOnly, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, name, email, role, engineer_id, holiday_pay_eligible, holiday_pay_rate, created_at FROM users ORDER BY name').all();
  res.json(users);
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, email, password, role, engineer_id, holiday_pay_eligible, holiday_pay_rate } = req.body;
  const db = getDb();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (name, email, password, role, engineer_id, holiday_pay_eligible, holiday_pay_rate) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, email, hash, role || 'engineer', engineer_id || null, holiday_pay_eligible ? 1 : 0, holiday_pay_rate || 0);
    res.json({ id: result.lastInsertRowid, name, email, role: role || 'engineer' });
  } catch (e) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { name, email, role, engineer_id, password, holiday_pay_eligible, holiday_pay_rate } = req.body;
  const db = getDb();
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, email=?, role=?, engineer_id=?, password=?, holiday_pay_eligible=?, holiday_pay_rate=? WHERE id=?').run(name, email, role, engineer_id, hash, holiday_pay_eligible ? 1 : 0, holiday_pay_rate || 0, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?, email=?, role=?, engineer_id=?, holiday_pay_eligible=?, holiday_pay_rate=? WHERE id=?').run(name, email, role, engineer_id, holiday_pay_eligible ? 1 : 0, holiday_pay_rate || 0, req.params.id);
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
  const { name, contact, contact_title, email, phone, address, supplier_number, payment_terms, ap_email } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO customers (name, contact, email, phone, address, supplier_number, payment_terms, ap_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, contact, email, phone, address, supplier_number, payment_terms || 'Net 30', ap_email || null);
  const customerId = result.lastInsertRowid;

  // Auto-create a contact record if primary contact name is provided
  if (contact && contact.trim()) {
    db.prepare('INSERT INTO customer_contacts (customer_id, name, title, email, phone) VALUES (?, ?, ?, ?, ?)').run(customerId, contact, contact_title || '', email || '', phone || '');
  }

  res.json({ id: customerId, ...req.body });
});

app.put('/api/customers/:id', auth, adminOnly, (req, res) => {
  const { name, contact, email, phone, address, supplier_number, payment_terms, ap_email } = req.body;
  const db = getDb();
  db.prepare('UPDATE customers SET name=?, contact=?, email=?, phone=?, address=?, supplier_number=?, payment_terms=?, ap_email=? WHERE id=?').run(name, contact, email, phone, address, supplier_number, payment_terms || 'Net 30', ap_email || null, req.params.id);
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
  const { customer_id, contact_id, name, description, po_number, po_amount, location, status, include_timesheets } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO projects (customer_id, contact_id, name, description, po_number, po_amount, location, status, include_timesheets) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(customer_id, contact_id || null, name, description || null, po_number, po_amount || 0, location, status || 'active', include_timesheets !== false ? 1 : 0);
  res.json({ id: result.lastInsertRowid, ...req.body });
});

app.put('/api/projects/:id', auth, adminOnly, (req, res) => {
  const { customer_id, contact_id, name, description, po_number, po_amount, location, status, include_timesheets } = req.body;
  const db = getDb();
  db.prepare('UPDATE projects SET customer_id=?, contact_id=?, name=?, description=?, po_number=?, po_amount=?, location=?, status=?, include_timesheets=? WHERE id=?').run(customer_id, contact_id || null, name, description || null, po_number, po_amount, location, status, include_timesheets ? 1 : 0, req.params.id);
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

// Get all engineer-project assignments (for filtering)
app.get('/api/engineer-projects', auth, adminOnly, (req, res) => {
  const db = getDb();
  const assignments = db.prepare(`
    SELECT ep.*, u.name as engineer_name
    FROM engineer_projects ep
    JOIN users u ON u.id = ep.user_id
  `).all();
  res.json(assignments);
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

app.put('/api/timesheets/:id/submit', auth, async (req, res) => {
  const db = getDb();
  const ts = db.prepare(`
    SELECT ts.*, u.name as engineer_name, p.name as project_name, c.name as customer_name,
           COALESCE((SELECT SUM(hours) FROM timesheet_entries WHERE timesheet_id = ts.id), 0) as total_hours
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE ts.id = ?
  `).get(req.params.id);
  if (!ts) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ts.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE timesheets SET status='submitted', submitted_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);

  // Send notification email to admin
  const weekEnding = new Date(ts.week_ending + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  sendNotificationEmail(
    `Timesheet Submitted - ${ts.engineer_name}`,
    `
    <h2>New Timesheet Submitted</h2>
    <p>A timesheet has been submitted and is ready for your review.</p>
    <table style="border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Engineer:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.engineer_name}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Project:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.project_name}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Customer:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.customer_name}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Week Ending:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${weekEnding}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Hours:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.total_hours.toFixed(2)}</td></tr>
    </table>
    <p>Log in to <a href="https://timetracker.utechconsulting.net">UTech TimeTracker</a> to review and approve.</p>
    `
  );

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

// Email an invoice with PDF attachment
app.post('/api/invoices/:id/email', auth, adminOnly, async (req, res) => {
  const db = getDb();

  // Get invoice with all related info
  const invoice = db.prepare(`
    SELECT i.*, p.name as project_name, p.description as project_description, p.po_number, p.location,
           p.include_timesheets,
           c.name as customer_name, c.address as customer_address, c.supplier_number, c.payment_terms,
           c.ap_email, c.email as customer_email,
           cc.name as contact_name, cc.email as contact_email
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Get email settings
  const settings = {};
  const rows = db.prepare("SELECT key, value FROM settings").all();
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  if (!settings.smtp_email || !settings.smtp_password) {
    return res.status(400).json({ error: 'Email not configured. Set up SMTP in Settings.' });
  }

  if (!invoice.ap_email) {
    return res.status(400).json({ error: 'No AP email set for this customer. Add AP email in Customers.' });
  }

  // Build CC list
  const ccList = [];
  if (invoice.contact_email) ccList.push(invoice.contact_email);
  if (settings.admin_notification_email) ccList.push(settings.admin_notification_email);

  // Get line items and timesheet details
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
      timesheetDetails.push({
        engineer_name: ts.engineer_name,
        engineer_id: ts.engineer_id,
        week_ending: ts.week_ending,
        bill_rate: ts.bill_rate,
        total_hours: hrs,
        entries
      });
    }
  }

  // Helper functions
  const formatCurrency = (amt) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amt || 0);
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr.split('T')[0] + 'T00:00:00');
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
  const invoiceDate = new Date(invoice.created_at);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + daysUntilDue);
  const dueDateStr = dueDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  const invoiceDateStr = formatDate(invoice.created_at);
  const periodRange = `${formatDate(invoice.period_start)} to ${formatDate(invoice.period_end)}`;

  // Build invoice page HTML (matches print view)
  const lineItemsHtml = lineItems.length > 0 ? lineItems.map(item => `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${item.hours.toFixed(0)}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.po_number || 'Engineering'}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.project_description || 'Engineering Labor Hours'} - ${item.engineer} - ${periodRange}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">$${item.rate.toFixed(2)}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;"></td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">$${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  `).join('') : `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${(invoice.total_hours || 0).toFixed(0)}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.po_number || 'Engineering'}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.project_description || 'Engineering Labor Hours'} - ${periodRange}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">—</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;"></td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">$${(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
          <tr><td style="padding: 4px 12px; text-align: right;">Subtotal</td><td style="padding: 4px 12px; text-align: right; font-weight: bold;">$${(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding: 4px 12px; text-align: right;">Sales tax</td><td style="padding: 4px 12px; text-align: right;">$0.00</td></tr>
          <tr style="border-top: 2px solid #000;"><td style="padding: 8px 12px; text-align: right; font-weight: bold; font-size: 14px;">Total</td><td style="padding: 8px 12px; text-align: right; font-weight: bold; font-size: 14px;">$${(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
        </table>
      </div>
    </div>
  `;

  // Build timesheet pages HTML (only if include_timesheets is set)
  let timesheetPagesHtml = '';
  if (invoice.include_timesheets && timesheetDetails.length > 0) {
    timesheetPagesHtml = timesheetDetails.map(ts => {
      const weekEnding = formatDate(ts.week_ending);
      const rate = ts.bill_rate || 0;
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      // Build entries by date map
      const entriesByDate = {};
      ts.entries.forEach(e => {
        const dateKey = e.entry_date ? e.entry_date.split('T')[0] : '';
        if (dateKey) entriesByDate[dateKey] = e;
      });

      // Calculate week dates
      const weekEnd = new Date(ts.week_ending + 'T00:00:00');
      const weekDates = [];
      for (let i = -6; i <= 0; i++) {
        const d = new Date(weekEnd);
        d.setDate(weekEnd.getDate() + i);
        weekDates.push(d.toISOString().split('T')[0]);
      }

      // Calculate totals
      let totalST = 0;
      weekDates.forEach(date => {
        const entry = entriesByDate[date];
        if (entry && entry.hours) totalST += entry.hours;
      });
      const laborSubtotal = totalST * rate;

      // Build rows
      const rowsHtml = weekDates.map((date, idx) => {
        const entry = entriesByDate[date] || {};
        const dateObj = new Date(date + 'T00:00:00');
        const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
        const hours = entry.hours || 0;
        const st = hours > 0 ? hours.toFixed(1) : '0.0';

        return `
          <tr>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${formattedDate} ${dayNames[idx]}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${invoice.location || ''}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;"></td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${entry.shift || '1'}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;"></td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${formatTime(entry.start_time)}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${formatTime(entry.end_time)}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${st}</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.0</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.0</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.0</td>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">0.0</td>
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
              <div style="font-size: 5pt;">Mon shift 1 - Sun shift 3<br/>$${rate.toFixed(2)}/hr | ST = All | OT/PT = N/A</div>
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
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">${totalST.toFixed(1)}</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.0</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.0</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.0</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">0.0</td>
                <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center; font-weight: bold;">${totalST.toFixed(1)}</td>
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
              <div style="padding: 0 2px; font-size: 5pt;">Air: $0 | Car: $0 | Meals: $0 | Parking: $0 | Misc: $0</div>
              <div style="text-align: right; padding: 0 2px; font-size: 5pt;"><strong>Exp Subtotal:</strong> $0.00</div>
              <div style="text-align: right; padding: 0 2px; font-size: 5pt;">Rate: $${rate.toFixed(2)}/hr | Hours: ${totalST.toFixed(1)}</div>
              <div style="text-align: right; padding: 1px 2px; font-weight: bold; font-size: 6pt;">Total: $${laborSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
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

  try {
    // Generate PDF with puppeteer
    // Use different browser options for local vs cloud environments
    let browserOptions;
    const isLocal = process.platform === 'win32' || !process.env.RENDER;

    if (isLocal) {
      // Local development - try common Chrome paths
      const fs = require('fs');
      const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      ];
      const chromePath = possiblePaths.find(p => fs.existsSync(p));
      if (!chromePath) {
        throw new Error('Chrome not found. Please install Google Chrome for local PDF generation.');
      }
      browserOptions = {
        executablePath: chromePath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      };
    } else {
      // Cloud/Render environment - use @sparticuz/chromium
      browserOptions = {
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      };
    }

    const browser = await puppeteer.launch(browserOptions);
    const page = await browser.newPage();
    await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.25in', right: '0.25in', bottom: '0.25in', left: '0.25in' } });
    await browser.close();

    // Send email with PDF attachment
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: settings.smtp_email, pass: settings.smtp_password },
    });

    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <p>Please find attached Invoice #${invoice.invoice_number} for ${invoice.project_name}.</p>
        <p><strong>Invoice Summary:</strong></p>
        <ul>
          <li>Invoice #: ${invoice.invoice_number}</li>
          <li>Amount: ${formatCurrency(invoice.total_amount)}</li>
          <li>Due Date: ${dueDateStr}</li>
          <li>Payment Terms: ${invoice.payment_terms || 'Net 30'}</li>
        </ul>
        <p>If you have any questions, please contact us at ${settings.company_email || settings.smtp_email}.</p>
        <p>Thank you for your business!</p>
        <p style="color: #666; font-size: 12px;">${settings.company_name || 'UTech TimeTracker'}</p>
      </div>
    `;

    await transporter.sendMail({
      from: settings.smtp_email,
      to: invoice.ap_email,
      cc: ccList.length > 0 ? ccList.join(', ') : undefined,
      subject: `Invoice #${invoice.invoice_number} from ${settings.company_name || 'UTech TimeTracker'} - ${invoice.project_name}`,
      html: emailBody,
      attachments: [{
        filename: `${invoice.po_number || 'N-A'} - ${invoice.project_name} - ${formatDate(invoice.period_start)} to ${formatDate(invoice.period_end)}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });

    // Record that the invoice was emailed
    db.prepare('UPDATE invoices SET emailed_at = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);

    res.json({ success: true, message: `Invoice emailed to ${invoice.ap_email}` + (ccList.length > 0 ? ` (CC: ${ccList.join(', ')})` : '') });
  } catch (err) {
    console.error('Failed to send invoice email:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
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

  // Get regular timesheet payroll data
  const timesheetData = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id,
           u.holiday_pay_eligible, u.holiday_pay_rate,
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

  // Get holidays in the date range
  const holidays = db.prepare(`
    SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date
  `).all(period_start, period_end);

  // Get all holiday-eligible engineers (even if they have no timesheets)
  const eligibleEngineers = db.prepare(`
    SELECT id, name, engineer_id, holiday_pay_rate
    FROM users
    WHERE holiday_pay_eligible = 1 AND holiday_pay_rate > 0
  `).all();

  // Calculate total holiday hours for the period
  const totalHolidayHours = holidays.reduce((sum, h) => sum + (h.hours || 8), 0);

  // Build the response: include regular timesheet data plus holiday pay entries
  const data = [...timesheetData];

  // Add holiday pay entry for each eligible engineer
  for (const eng of eligibleEngineers) {
    if (totalHolidayHours > 0) {
      const holidayPay = totalHolidayHours * eng.holiday_pay_rate;
      data.push({
        user_id: eng.id,
        engineer_name: eng.name,
        engineer_id: eng.engineer_id,
        total_hours: totalHolidayHours,
        pay_rate: eng.holiday_pay_rate,
        total_pay: holidayPay,
        bill_rate: 0,
        total_billed: 0,
        project_name: 'Holiday Pay',
        po_number: holidays.map(h => h.name).join(', '),
        is_holiday_pay: true
      });
    }
  }

  // Sort by engineer name, then project name
  data.sort((a, b) => {
    if (a.engineer_name !== b.engineer_name) {
      return a.engineer_name.localeCompare(b.engineer_name);
    }
    return a.project_name.localeCompare(b.project_name);
  });

  res.json({ data, holidays });
});

// Invoiced report by date range
app.get('/api/reports/invoiced', auth, adminOnly, (req, res) => {
  const { period_start, period_end } = req.query;
  const db = getDb();
  const data = db.prepare(`
    SELECT i.id, i.invoice_number, i.created_at, i.period_start, i.period_end,
           i.total_hours, i.total_amount, i.amount_paid, i.status,
           p.name as project_name, p.po_number,
           c.name as customer_name
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE DATE(i.created_at) BETWEEN ? AND ?
    ORDER BY i.created_at DESC
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

// ─── BACKUP & RESTORE ─────────────────────────────────────────────────────────

// Backup all company data
app.get('/api/backup', (req, res) => {
  // Allow token in query string for direct download
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const db = getDb();
  try {
    const backup = {
      version: '1.0',
      created_at: new Date().toISOString(),
      data: {
        customers: db.prepare('SELECT * FROM customers').all(),
        customer_contacts: db.prepare('SELECT * FROM customer_contacts').all(),
        projects: db.prepare('SELECT * FROM projects').all(),
        users: db.prepare('SELECT id, name, email, role, engineer_id, created_at FROM users').all(), // exclude passwords
        engineer_projects: db.prepare('SELECT * FROM engineer_projects').all(),
        timesheets: db.prepare('SELECT * FROM timesheets').all(),
        timesheet_entries: db.prepare('SELECT * FROM timesheet_entries').all(),
        invoices: db.prepare('SELECT * FROM invoices').all(),
        payments: db.prepare('SELECT * FROM payments').all(),
        settings: db.prepare('SELECT * FROM settings').all(),
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="utech-timetracker-backup-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(backup);
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Restore from backup
app.post('/api/restore', auth, adminOnly, (req, res) => {
  const db = getDb();
  const { backup } = req.body;

  if (!backup || !backup.data) {
    return res.status(400).json({ error: 'Invalid backup file' });
  }

  try {
    const txn = db.transaction(() => {
      // Clear existing data (except current admin user)
      const currentUserId = req.user.id;
      db.prepare('DELETE FROM payments').run();
      db.prepare('DELETE FROM invoices').run();
      db.prepare('DELETE FROM timesheet_entries').run();
      db.prepare('DELETE FROM timesheets').run();
      db.prepare('DELETE FROM engineer_projects').run();
      db.prepare('DELETE FROM projects').run();
      db.prepare('DELETE FROM customer_contacts').run();
      db.prepare('DELETE FROM customers').run();
      db.prepare('DELETE FROM users WHERE id != ?').run(currentUserId);
      db.prepare('DELETE FROM settings').run();

      // Restore customers
      if (backup.data.customers) {
        for (const c of backup.data.customers) {
          db.prepare('INSERT INTO customers (id, name, contact, email, phone, address, supplier_number, payment_terms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            c.id, c.name, c.contact, c.email, c.phone, c.address, c.supplier_number, c.payment_terms, c.created_at
          );
        }
      }

      // Restore customer_contacts
      if (backup.data.customer_contacts) {
        for (const c of backup.data.customer_contacts) {
          db.prepare('INSERT INTO customer_contacts (id, customer_id, name, title, email, phone) VALUES (?, ?, ?, ?, ?, ?)').run(
            c.id, c.customer_id, c.name, c.title, c.email, c.phone
          );
        }
      }

      // Restore projects
      if (backup.data.projects) {
        for (const p of backup.data.projects) {
          db.prepare('INSERT INTO projects (id, customer_id, contact_id, name, description, po_number, po_amount, location, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            p.id, p.customer_id, p.contact_id, p.name, p.description, p.po_number, p.po_amount, p.location, p.status, p.created_at
          );
        }
      }

      // Restore users (except current admin)
      if (backup.data.users) {
        const defaultHash = bcrypt.hashSync('changeme123', 10);
        for (const u of backup.data.users) {
          if (u.id === currentUserId) continue;
          db.prepare('INSERT INTO users (id, name, email, password, role, engineer_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            u.id, u.name, u.email, defaultHash, u.role, u.engineer_id, u.created_at
          );
        }
      }

      // Restore engineer_projects
      if (backup.data.engineer_projects) {
        for (const ep of backup.data.engineer_projects) {
          db.prepare('INSERT OR IGNORE INTO engineer_projects (user_id, project_id, pay_rate, bill_rate) VALUES (?, ?, ?, ?)').run(
            ep.user_id, ep.project_id, ep.pay_rate, ep.bill_rate
          );
        }
      }

      // Restore timesheets
      if (backup.data.timesheets) {
        for (const t of backup.data.timesheets) {
          db.prepare('INSERT INTO timesheets (id, user_id, project_id, week_ending, status, submitted_at, approved_at, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            t.id, t.user_id, t.project_id, t.week_ending, t.status, t.submitted_at, t.approved_at, t.approved_by, t.created_at
          );
        }
      }

      // Restore timesheet_entries
      if (backup.data.timesheet_entries) {
        for (const e of backup.data.timesheet_entries) {
          db.prepare('INSERT INTO timesheet_entries (id, timesheet_id, entry_date, start_time, end_time, hours, description, shift) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
            e.id, e.timesheet_id, e.entry_date, e.start_time, e.end_time, e.hours, e.description, e.shift
          );
        }
      }

      // Restore invoices
      if (backup.data.invoices) {
        for (const i of backup.data.invoices) {
          db.prepare('INSERT INTO invoices (id, project_id, invoice_number, period_start, period_end, total_hours, total_amount, amount_paid, status, paid_date, voided_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            i.id, i.project_id, i.invoice_number, i.period_start, i.period_end, i.total_hours, i.total_amount, i.amount_paid, i.status, i.paid_date, i.voided_date, i.notes, i.created_at
          );
        }
      }

      // Restore payments
      if (backup.data.payments) {
        for (const p of backup.data.payments) {
          db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date, payment_method, reference_number, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
            p.id, p.invoice_id, p.amount, p.payment_date, p.payment_method, p.reference_number, p.notes, p.created_at
          );
        }
      }

      // Restore settings
      if (backup.data.settings) {
        for (const s of backup.data.settings) {
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(s.key, s.value);
        }
      }
    });

    txn();
    res.json({ success: true, message: 'Backup restored successfully. Note: User passwords have been reset to "changeme123"' });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reset company - start fresh
app.post('/api/reset-company', auth, adminOnly, (req, res) => {
  const db = getDb();
  const { confirm } = req.body;

  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Please confirm by sending confirm: "RESET"' });
  }

  try {
    const currentUserId = req.user.id;

    const txn = db.transaction(() => {
      db.prepare('DELETE FROM payments').run();
      db.prepare('DELETE FROM invoices').run();
      db.prepare('DELETE FROM timesheet_entries').run();
      db.prepare('DELETE FROM timesheets').run();
      db.prepare('DELETE FROM engineer_projects').run();
      db.prepare('DELETE FROM projects').run();
      db.prepare('DELETE FROM customer_contacts').run();
      db.prepare('DELETE FROM customers').run();
      db.prepare('DELETE FROM users WHERE id != ?').run(currentUserId);
      // Keep settings (company info, etc.)
    });

    txn();
    res.json({ success: true, message: 'Company data cleared. You can now start fresh.' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── SEED DATA (for testing) ──────────────────────────────────────────────────

app.post('/api/seed-demo-data', auth, adminOnly, (req, res) => {
  const db = getDb();

  try {
    const customerNames = [
      'Acme Corporation', 'TechFlow Industries', 'Global Systems Inc', 'Metro Solutions',
      'Summit Energy', 'Pacific Manufacturing', 'Delta Automation', 'Precision Controls',
      'Atlas Engineering', 'Vertex Technologies'
    ];

    const projectTypes = ['System Upgrade', 'Maintenance Contract', 'New Installation', 'Retrofit Project', 'Consulting'];
    const cities = ['Houston, TX 77001', 'Dallas, TX 75201', 'Austin, TX 78701', 'San Antonio, TX 78201', 'Fort Worth, TX 76101'];

    const engineerData = [
      { name: 'John Smith', email: 'john.smith@test.com', engineer_id: 'ENG001' },
      { name: 'Sarah Johnson', email: 'sarah.j@test.com', engineer_id: 'ENG002' },
      { name: 'Mike Williams', email: 'mike.w@test.com', engineer_id: 'ENG003' },
      { name: 'Emily Davis', email: 'emily.d@test.com', engineer_id: 'ENG004' },
      { name: 'Robert Brown', email: 'robert.b@test.com', engineer_id: 'ENG005' },
    ];

    const hash = bcrypt.hashSync('test123', 10);

    // Create engineers
    const engineerIds = [];
    for (const eng of engineerData) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(eng.email);
      if (existing) {
        engineerIds.push(existing.id);
      } else {
        const result = db.prepare('INSERT INTO users (name, email, password, role, engineer_id) VALUES (?, ?, ?, ?, ?)').run(eng.name, eng.email, hash, 'engineer', eng.engineer_id);
        engineerIds.push(result.lastInsertRowid);
      }
    }

    // Create customers and projects
    const projectIds = [];
    let poCounter = 10000;

    for (const custName of customerNames) {
      const existing = db.prepare('SELECT id FROM customers WHERE name = ?').get(custName);
      let customerId;
      if (existing) {
        customerId = existing.id;
      } else {
        const addr = `${Math.floor(Math.random() * 9000) + 1000} Industrial Blvd\n${cities[Math.floor(Math.random() * cities.length)]}`;
        const result = db.prepare('INSERT INTO customers (name, contact, email, phone, address, supplier_number, payment_terms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          custName, 'Primary Contact', `billing@${custName.toLowerCase().replace(/\s+/g, '')}.com`, '(555) 555-' + String(Math.floor(Math.random() * 9000) + 1000), addr, 'SUP' + String(poCounter), 'Net 30'
        );
        customerId = result.lastInsertRowid;
      }

      // Create 3 projects per customer
      for (let p = 0; p < 3; p++) {
        const projType = projectTypes[Math.floor(Math.random() * projectTypes.length)];
        const projName = `${custName.split(' ')[0]} ${projType}`;
        const existingProj = db.prepare('SELECT id FROM projects WHERE name = ? AND customer_id = ?').get(projName, customerId);

        if (!existingProj) {
          poCounter++;
          const poAmount = Math.floor(Math.random() * 50000) + 10000;
          const result = db.prepare('INSERT INTO projects (customer_id, name, po_number, po_amount, location, status) VALUES (?, ?, ?, ?, ?, ?)').run(
            customerId, projName, 'PO-' + poCounter, poAmount, cities[Math.floor(Math.random() * cities.length)].split(',')[0], 'active'
          );
          projectIds.push(result.lastInsertRowid);

          // Assign 2 random engineers to each project
          const assignedEngineers = [...engineerIds].sort(() => Math.random() - 0.5).slice(0, 2);
          for (const engId of assignedEngineers) {
            const payRate = Math.floor(Math.random() * 30) + 40; // $40-70/hr
            const billRate = payRate + Math.floor(Math.random() * 40) + 30; // pay + $30-70
            db.prepare('INSERT OR IGNORE INTO engineer_projects (user_id, project_id, pay_rate, bill_rate) VALUES (?, ?, ?, ?)').run(engId, result.lastInsertRowid, payRate, billRate);
          }
        } else {
          projectIds.push(existingProj.id);
        }
      }
    }

    // Create timesheets for past 12 weeks
    const today = new Date();
    let timesheetCount = 0;

    for (let weeksAgo = 1; weeksAgo <= 12; weeksAgo++) {
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() - (today.getDay()) - (weeksAgo * 7));
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      const projectsThisWeek = [...projectIds].sort(() => Math.random() - 0.5).slice(0, 5);

      for (const projId of projectsThisWeek) {
        const assignment = db.prepare('SELECT user_id FROM engineer_projects WHERE project_id = ? LIMIT 1').get(projId);
        if (!assignment) continue;

        const existingTs = db.prepare('SELECT id FROM timesheets WHERE project_id = ? AND week_ending = ? AND user_id = ?').get(projId, weekEndStr, assignment.user_id);
        if (existingTs) continue;

        const tsResult = db.prepare('INSERT INTO timesheets (user_id, project_id, week_ending, status, submitted_at, approved_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(
          assignment.user_id, projId, weekEndStr, 'approved'
        );
        const tsId = tsResult.lastInsertRowid;
        timesheetCount++;

        for (let d = 6; d >= 0; d--) {
          const entryDate = new Date(weekEnd);
          entryDate.setDate(weekEnd.getDate() - d);
          const entryDateStr = entryDate.toISOString().split('T')[0];
          const dayOfWeek = entryDate.getDay();

          let hours = 0, startTime = null, endTime = null;
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            hours = Math.floor(Math.random() * 4) + 6;
            startTime = '07:00';
            endTime = (7 + hours < 10 ? '0' : '') + (7 + hours) + ':00';
          }

          db.prepare('INSERT INTO timesheet_entries (timesheet_id, entry_date, start_time, end_time, hours, description, shift) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            tsId, entryDateStr, startTime, endTime, hours, hours > 0 ? 'System maintenance and support' : null, 1
          );
        }
      }
    }

    // Create 60 invoices directly
    let invoiceCount = 0;
    const maxInvNum = db.prepare('SELECT MAX(CAST(invoice_number AS INTEGER)) as m FROM invoices').get();
    let nextInvNum = (maxInvNum?.m || 999) + 1;

    for (let i = 0; i < 60; i++) {
      const projId = projectIds[i % projectIds.length];
      const weeksAgo = Math.floor(i / 2) + 1;

      const periodEnd = new Date(today);
      periodEnd.setDate(today.getDate() - (weeksAgo * 14));
      const periodEndStr = periodEnd.toISOString().split('T')[0];

      const periodStart = new Date(periodEnd);
      periodStart.setDate(periodEnd.getDate() - 13);
      const periodStartStr = periodStart.toISOString().split('T')[0];

      const totalHours = Math.floor(Math.random() * 60) + 20;
      const billRate = Math.floor(Math.random() * 50) + 75;
      const totalAmount = totalHours * billRate;

      db.prepare('INSERT INTO invoices (project_id, invoice_number, period_start, period_end, total_hours, total_amount, status, amount_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        projId, String(nextInvNum), periodStartStr, periodEndStr, totalHours, totalAmount, 'unpaid', 0
      );
      nextInvNum++;
      invoiceCount++;
    }

    res.json({ success: true, message: `Created demo data: ${engineerIds.length} engineers, ${projectIds.length} projects, ${timesheetCount} timesheets, ${invoiceCount} invoices` });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve React app for any non-API routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
