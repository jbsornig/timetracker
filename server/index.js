const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { getDb, backupDatabase, replaceDatabase, BACKUP_DIR } = require('./db');
const multer = require('multer');
const { auth, adminOnly, JWT_SECRET } = require('./middleware');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const formatMoney = (amt) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amt || 0);

// ─── EMAIL HELPER ─────────────────────────────────────────────────────────────

async function sendTelegram(text, botToken, chatId) {
  const https = require('https');
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendNotification(subject, htmlBody, textBody) {
  const db = getDb();
  const settings = {};
  const keys = ['smtp_email', 'smtp_password', 'admin_notification_email', 'notification_method', 'telegram_bot_token', 'telegram_chat_id'];
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  const method = settings.notification_method || 'email';
  if (method === 'none') return;

  // Send email if method is 'email' or 'both'
  if ((method === 'email' || method === 'both') && settings.smtp_email && settings.smtp_password && settings.admin_notification_email) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: settings.smtp_email, pass: settings.smtp_password },
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

  // Send Telegram if method is 'telegram' or 'both'
  if ((method === 'telegram' || method === 'both') && settings.telegram_bot_token && settings.telegram_chat_id) {
    try {
      const msg = textBody || subject;
      const result = await sendTelegram(msg, settings.telegram_bot_token, settings.telegram_chat_id);
      if (result.ok) {
        console.log('Telegram notification sent successfully');
      } else {
        console.error('Telegram error:', result.description || JSON.stringify(result));
      }
    } catch (err) {
      console.error('Failed to send Telegram notification:', err.message);
    }
  }
}

// Backward-compatible alias
async function sendNotificationEmail(subject, htmlBody) {
  return sendNotification(subject, htmlBody);
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

  // Update last_login timestamp
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/me', auth, (req, res) => {
  const db = getDb();
  // Update last_login when session is validated (user opened the app)
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
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

// ─── BACKUPS ──────────────────────────────────────────────────────────────────

app.post('/api/backups', auth, adminOnly, (req, res) => {
  const result = backupDatabase();
  const fs = require('fs');
  const backups = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('timetracker-') && f.endsWith('.db'))
        .sort().reverse()
        .map(f => ({
          name: f,
          size: fs.statSync(path.join(BACKUP_DIR, f)).size,
          created: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
        }))
    : [];
  res.json({ success: true, backups });
});

app.get('/api/backups', auth, adminOnly, (req, res) => {
  const fs = require('fs');
  const backups = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('timetracker-') && f.endsWith('.db'))
        .sort().reverse()
        .map(f => ({
          name: f,
          size: fs.statSync(path.join(BACKUP_DIR, f)).size,
          created: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
        }))
    : [];
  res.json(backups);
});

// Download a specific backup file
app.get('/api/backups/:filename/download', auth, adminOnly, (req, res) => {
  const fs = require('fs');
  const filename = req.params.filename;
  // Sanitize: only allow timetracker-*.db filenames
  if (!/^timetracker-[\dT\-Z]+\.db$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid backup filename' });
  }
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup file not found' });
  }
  res.download(filePath, filename);
});

// Restore database from uploaded .db file
const dbUpload = multer({ dest: require('os').tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });
app.post('/api/backups/restore-db', auth, adminOnly, dbUpload.single('database'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const fs = require('fs');
    // Validate it's a real SQLite file (magic bytes: "SQLite format 3\0")
    const buf = Buffer.alloc(16);
    const fd = fs.openSync(req.file.path, 'r');
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (buf.toString('utf8', 0, 15) !== 'SQLite format 3') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid file — not a SQLite database' });
    }

    // Backup current database first
    backupDatabase();

    // Replace with uploaded file
    replaceDatabase(req.file.path);

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    res.json({ success: true, message: 'Database restored successfully. You may need to refresh the page.' });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
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

// Test email endpoint
app.post('/api/test-email', auth, adminOnly, async (req, res) => {
  const db = getDb();
  const settings = {};
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('smtp_email', 'smtp_password', 'admin_notification_email')").all();
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  if (!settings.smtp_email || !settings.smtp_password || !settings.admin_notification_email) {
    return res.status(400).json({ error: 'Email settings not fully configured. Please fill in all email fields and save settings first.' });
  }

  console.log('=== TEST EMAIL ===');
  console.log('From:', settings.smtp_email);
  console.log('To:', settings.admin_notification_email);

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: settings.smtp_email,
        pass: settings.smtp_password,
      },
    });

    // Verify connection first
    console.log('Verifying SMTP connection...');
    await transporter.verify();
    console.log('SMTP connection verified successfully');

    const info = await transporter.sendMail({
      from: settings.smtp_email,
      to: settings.admin_notification_email,
      subject: 'TimeTracker Test Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e3a5f;">TimeTracker Email Test</h2>
          <p>This is a test email from your TimeTracker system.</p>
          <p>If you received this email, your email configuration is working correctly!</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #64748b; font-size: 12px;">
            Sent from: ${settings.smtp_email}<br>
            Sent to: ${settings.admin_notification_email}<br>
            Time: ${new Date().toLocaleString()}
          </p>
        </div>
      `,
    });

    console.log('Email sent! Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);

    res.json({
      success: true,
      message: `Test email sent successfully! Message ID: ${info.messageId}`,
      details: {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected
      }
    });
  } catch (err) {
    console.error('Test email failed:', err);
    res.status(500).json({ error: `Failed to send email: ${err.message}` });
  }
});

// Get Telegram chat ID by checking recent messages to the bot
app.post('/api/telegram/get-chat-id', auth, adminOnly, async (req, res) => {
  const db = getDb();
  const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get();
  const botToken = tokenRow?.value;
  if (!botToken) return res.status(400).json({ error: 'Telegram bot token not configured. Save your settings first.' });

  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get(`https://api.telegram.org/bot${botToken}/getUpdates?limit=10`, (resp) => {
        let d = '';
        resp.on('data', chunk => d += chunk);
        resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Invalid response')); } });
      }).on('error', reject);
    });

    if (!data.ok) return res.status(400).json({ error: 'Telegram API error: ' + (data.description || 'Unknown error. Check your bot token.') });

    const messages = data.result || [];
    if (messages.length === 0) {
      return res.status(400).json({ error: 'No messages found. Please open Telegram, find @UTechTimeBot, and send it any message first. Then try again.' });
    }

    // Get the most recent chat ID
    const lastMsg = messages[messages.length - 1];
    const chatId = lastMsg.message?.chat?.id || lastMsg.channel_post?.chat?.id;
    const chatName = lastMsg.message?.chat?.first_name || lastMsg.message?.chat?.title || 'Unknown';

    if (!chatId) return res.status(400).json({ error: 'Could not determine chat ID from messages.' });

    // Save it
    const existing = db.prepare("SELECT id FROM settings WHERE key = 'telegram_chat_id'").get();
    if (existing) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'telegram_chat_id'").run(String(chatId));
    } else {
      db.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', ?)").run(String(chatId));
    }

    res.json({ success: true, chat_id: chatId, chat_name: chatName, message: `Chat ID detected: ${chatId} (${chatName}). Saved!` });
  } catch (err) {
    res.status(500).json({ error: 'Failed: ' + err.message });
  }
});

app.post('/api/test-telegram', auth, adminOnly, async (req, res) => {
  const db = getDb();
  const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get();
  const chatRow = db.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").get();
  const botToken = tokenRow?.value;
  const chatId = chatRow?.value;

  if (!botToken) return res.status(400).json({ error: 'Telegram bot token not configured.' });
  if (!chatId) return res.status(400).json({ error: 'Telegram chat ID not detected. Click "Detect Chat ID" first.' });

  try {
    const result = await sendTelegram('TimeTracker test: Telegram notifications are working!', botToken, chatId);
    if (result.ok) {
      res.json({ success: true, message: 'Test message sent to Telegram!' });
    } else {
      res.status(400).json({ error: 'Telegram error: ' + (result.description || 'Unknown error') });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed: ' + err.message });
  }
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
  const users = db.prepare('SELECT id, name, email, role, engineer_id, holiday_pay_eligible, holiday_pay_rate, bank_routing, bank_account, bank_account_type, bank_routing_2, bank_account_2, bank_account_type_2, bank_pct_1, bank_pct_2, created_at, last_login FROM users ORDER BY name').all();
  // Mask bank account numbers for display (show last 4 only)
  const masked = users.map(u => ({
    ...u,
    bank_account_masked: u.bank_account ? '****' + u.bank_account.slice(-4) : null,
    bank_routing_masked: u.bank_routing ? '****' + u.bank_routing.slice(-4) : null,
    bank_account_2_masked: u.bank_account_2 ? '****' + u.bank_account_2.slice(-4) : null,
    bank_routing_2_masked: u.bank_routing_2 ? '****' + u.bank_routing_2.slice(-4) : null,
    has_banking: !!(u.bank_routing && u.bank_account),
    has_split: !!(u.bank_routing_2 && u.bank_account_2 && u.bank_pct_2 > 0)
  }));
  res.json(masked);
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, email, password, role, engineer_id, holiday_pay_eligible, holiday_pay_rate,
          bank_routing, bank_account, bank_account_type,
          bank_routing_2, bank_account_2, bank_account_type_2, bank_pct_1, bank_pct_2 } = req.body;
  const db = getDb();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`INSERT INTO users (name, email, password, role, engineer_id, holiday_pay_eligible, holiday_pay_rate,
      bank_routing, bank_account, bank_account_type, bank_routing_2, bank_account_2, bank_account_type_2, bank_pct_1, bank_pct_2)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        name, email, hash, role || 'engineer', engineer_id || null,
        holiday_pay_eligible ? 1 : 0, holiday_pay_rate || 0,
        bank_routing || null, bank_account || null, bank_account_type || 'checking',
        bank_routing_2 || null, bank_account_2 || null, bank_account_type_2 || 'checking',
        bank_pct_1 ?? 100, bank_pct_2 ?? 0
      );
    res.json({ id: result.lastInsertRowid, name, email, role: role || 'engineer' });
  } catch (e) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { name, email, role, engineer_id, password, holiday_pay_eligible, holiday_pay_rate,
          bank_routing, bank_account, bank_account_type,
          bank_routing_2, bank_account_2, bank_account_type_2, bank_pct_1, bank_pct_2 } = req.body;
  const db = getDb();

  // Get current user to preserve banking info if not provided (masked fields)
  const current = db.prepare('SELECT bank_routing, bank_account, bank_account_type, bank_routing_2, bank_account_2, bank_account_type_2, bank_pct_1, bank_pct_2 FROM users WHERE id = ?').get(req.params.id);

  const finalRouting = bank_routing || current?.bank_routing || null;
  const finalAccount = bank_account || current?.bank_account || null;
  const finalAccountType = bank_account_type || current?.bank_account_type || 'checking';
  const finalRouting2 = bank_routing_2 || current?.bank_routing_2 || null;
  const finalAccount2 = bank_account_2 || current?.bank_account_2 || null;
  const finalAccountType2 = bank_account_type_2 || current?.bank_account_type_2 || 'checking';
  const finalPct1 = bank_pct_1 ?? current?.bank_pct_1 ?? 100;
  const finalPct2 = bank_pct_2 ?? current?.bank_pct_2 ?? 0;

  const updateFields = `name=?, email=?, role=?, engineer_id=?, holiday_pay_eligible=?, holiday_pay_rate=?,
    bank_routing=?, bank_account=?, bank_account_type=?,
    bank_routing_2=?, bank_account_2=?, bank_account_type_2=?, bank_pct_1=?, bank_pct_2=?`;

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`UPDATE users SET ${updateFields}, password=? WHERE id=?`).run(
      name, email, role, engineer_id, holiday_pay_eligible ? 1 : 0, holiday_pay_rate || 0,
      finalRouting, finalAccount, finalAccountType,
      finalRouting2, finalAccount2, finalAccountType2, finalPct1, finalPct2,
      hash, req.params.id
    );
  } else {
    db.prepare(`UPDATE users SET ${updateFields} WHERE id=?`).run(
      name, email, role, engineer_id, holiday_pay_eligible ? 1 : 0, holiday_pay_rate || 0,
      finalRouting, finalAccount, finalAccountType,
      finalRouting2, finalAccount2, finalAccountType2, finalPct1, finalPct2,
      req.params.id
    );
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
    // For admin, compute amount_billed differently for hourly vs fixed price
    projects = db.prepare(`
      SELECT p.*, c.name as customer_name, cc.name as contact_name,
        COALESCE(SUM(CASE WHEN p.project_type = 'fixed_price' THEN 0 ELSE te.hours END), 0) as hours_used,
        COALESCE(
          CASE WHEN p.project_type = 'fixed_price'
            THEN (SELECT COALESCE(SUM(ts2.amount), 0) FROM timesheets ts2 WHERE ts2.project_id = p.id AND ts2.status = 'approved')
            ELSE SUM(te.hours * ep.bill_rate)
          END, 0
        ) as amount_billed
      FROM projects p
      JOIN customers c ON p.customer_id = c.id
      LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
      LEFT JOIN timesheets ts ON ts.project_id = p.id AND ts.status = 'approved'
      LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
      LEFT JOIN engineer_projects ep ON ep.project_id = p.id AND ep.user_id = ts.user_id
      GROUP BY p.id ORDER BY c.name, p.name
    `).all();
  } else {
    // For engineers: show personal hours and project-wide hours separately
    // my_hours_approved/pending = this engineer only
    // project_hours_approved/pending = all engineers on this project
    projects = db.prepare(`
      SELECT p.*, c.name as customer_name, cc.name as contact_name, ep.pay_rate, ep.total_payment,
        -- My personal hours (this engineer only)
        COALESCE((SELECT SUM(te.hours) FROM timesheet_entries te
                  JOIN timesheets ts ON ts.id = te.timesheet_id
                  WHERE ts.project_id = p.id AND ts.user_id = ? AND ts.status = 'approved'), 0) as my_hours_approved,
        COALESCE((SELECT SUM(te.hours) FROM timesheet_entries te
                  JOIN timesheets ts ON ts.id = te.timesheet_id
                  WHERE ts.project_id = p.id AND ts.user_id = ? AND ts.status IN ('draft', 'submitted')), 0) as my_hours_pending,
        -- Project-wide hours (all engineers)
        COALESCE((SELECT SUM(te.hours) FROM timesheet_entries te
                  JOIN timesheets ts ON ts.id = te.timesheet_id
                  WHERE ts.project_id = p.id AND ts.status = 'approved'), 0) as project_hours_approved,
        COALESCE((SELECT SUM(te.hours) FROM timesheet_entries te
                  JOIN timesheets ts ON ts.id = te.timesheet_id
                  WHERE ts.project_id = p.id AND ts.status IN ('draft', 'submitted')), 0) as project_hours_pending,
        -- Budgeted hours for this engineer (PO / bill rate)
        CASE
          WHEN p.project_type = 'fixed_price' THEN NULL
          WHEN ep.bill_rate > 0 THEN ROUND(p.po_amount / ep.bill_rate, 1)
          ELSE NULL
        END as budgeted_hours
      FROM projects p
      JOIN customers c ON p.customer_id = c.id
      LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
      JOIN engineer_projects ep ON ep.project_id = p.id AND ep.user_id = ?
      WHERE p.status = 'active'
      ORDER BY c.name, p.name
    `).all(req.user.id, req.user.id, req.user.id);
  }
  res.json(projects);
});

app.post('/api/projects', auth, adminOnly, (req, res) => {
  const { customer_id, contact_id, name, description, po_number, po_amount, location, status, include_timesheets, project_type, total_cost, requires_daily_logs } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO projects (customer_id, contact_id, name, description, po_number, po_amount, location, status, include_timesheets, project_type, total_cost, requires_daily_logs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(customer_id, contact_id || null, name, description || null, po_number, po_amount || 0, location, status || 'active', include_timesheets !== false ? 1 : 0, project_type || 'hourly', total_cost || 0, requires_daily_logs !== false ? 1 : 0);
  res.json({ id: result.lastInsertRowid, ...req.body });
});

app.put('/api/projects/:id', auth, adminOnly, (req, res) => {
  const { customer_id, contact_id, name, description, po_number, po_amount, location, status, include_timesheets, project_type, total_cost, requires_daily_logs } = req.body;
  const db = getDb();
  db.prepare('UPDATE projects SET customer_id=?, contact_id=?, name=?, description=?, po_number=?, po_amount=?, location=?, status=?, include_timesheets=?, project_type=?, total_cost=?, requires_daily_logs=? WHERE id=?').run(customer_id, contact_id || null, name, description || null, po_number, po_amount, location, status, include_timesheets ? 1 : 0, project_type || 'hourly', total_cost || 0, requires_daily_logs ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/projects/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  try {
    // Check for related invoices
    const invoices = db.prepare('SELECT COUNT(*) as count FROM invoices WHERE project_id = ?').get(req.params.id);
    if (invoices.count > 0) {
      return res.status(400).json({ error: `Cannot delete: ${invoices.count} invoice(s) exist for this project. Delete invoices first.` });
    }

    // Delete related records first
    db.prepare('DELETE FROM timesheet_entries WHERE timesheet_id IN (SELECT id FROM timesheets WHERE project_id = ?)').run(req.params.id);
    db.prepare('DELETE FROM timesheets WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM engineer_projects WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ error: err.message });
  }
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
  const { user_id, pay_rate, bill_rate, total_payment, monthly_pay, monthly_bill } = req.body;
  const db = getDb();
  try {
    db.prepare('INSERT OR REPLACE INTO engineer_projects (user_id, project_id, pay_rate, bill_rate, total_payment, monthly_pay, monthly_bill) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user_id, req.params.id, pay_rate || 0, bill_rate || 0, total_payment || 0, monthly_pay || 0, monthly_bill || 0);
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
           c.name as customer_name, p.po_number, p.project_type, p.requires_daily_logs,
           COALESCE(SUM(te.hours), 0) as total_hours,
           ep.pay_rate, ep.total_payment
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
           p.name as project_name, p.po_number, p.location, p.project_type, p.total_cost, p.requires_daily_logs,
           c.name as customer_name, ep.bill_rate, ep.pay_rate, ep.total_payment, ep.monthly_pay, ep.monthly_bill
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
  const { project_id, week_ending, period_start, period_end, percentage, monthly_hours, description } = req.body;
  const user_id = req.user.role === 'admin' && req.body.user_id ? req.body.user_id : req.user.id;
  const db = getDb();

  // Check project type and settings
  const project = db.prepare('SELECT project_type, total_cost, requires_daily_logs FROM projects WHERE id = ?').get(project_id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const isMonthly = project.project_type !== 'fixed_price' && project.requires_daily_logs === 0;

  try {
    if (project.project_type === 'fixed_price') {
      // Fixed price: use date range and percentage instead of weekly entries
      if (!period_start || !period_end || !percentage) {
        return res.status(400).json({ error: 'Period start, end, and percentage are required for fixed price projects' });
      }
      // Get engineer's total_payment for this project
      const ep = db.prepare('SELECT total_payment FROM engineer_projects WHERE user_id = ? AND project_id = ?').get(user_id, project_id);
      const totalPayment = ep?.total_payment || 0;
      // Calculate amount based on percentage of total_payment
      const amount = (percentage / 100) * totalPayment;
      // For fixed price, week_ending can be same as period_end
      const result = db.prepare('INSERT INTO timesheets (user_id, project_id, week_ending, period_start, period_end, percentage, amount) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user_id, project_id, period_end, period_start, period_end, percentage, amount);
      res.json({ id: result.lastInsertRowid });
    } else if (isMonthly) {
      // Monthly hours: simple total without daily breakdown
      if (!period_start || !period_end || !monthly_hours) {
        return res.status(400).json({ error: 'Month and hours are required' });
      }
      const result = db.prepare('INSERT INTO timesheets (user_id, project_id, week_ending, period_start, period_end, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(user_id, project_id, period_end, period_start, period_end, 'submitted');
      // Create single entry with total hours
      db.prepare('INSERT INTO timesheet_entries (timesheet_id, entry_date, hours, description) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, period_end, parseFloat(monthly_hours), description || null);
      res.json({ id: result.lastInsertRowid });
    } else {
      // Hourly: traditional weekly timesheet with daily entries
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
    }
  } catch (e) {
    res.status(400).json({ error: e.message || 'Error creating timesheet' });
  }
});

// Update fixed price timesheet
app.put('/api/timesheets/:id/fixed-price', auth, (req, res) => {
  const { period_start, period_end, percentage } = req.body;
  const db = getDb();
  const ts = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(req.params.id);
  if (!ts) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ts.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (ts.status === 'approved') return res.status(400).json({ error: 'Cannot edit approved timesheet' });

  // Get engineer's total_payment for this project
  const ep = db.prepare('SELECT total_payment FROM engineer_projects WHERE user_id = ? AND project_id = ?').get(ts.user_id, ts.project_id);
  const totalPayment = ep?.total_payment || 0;
  const amount = (percentage / 100) * totalPayment;

  db.prepare('UPDATE timesheets SET period_start=?, period_end=?, week_ending=?, percentage=?, amount=? WHERE id=?')
    .run(period_start, period_end, period_end, percentage, amount, req.params.id);
  res.json({ success: true });
});

app.put('/api/timesheets/:id/entries', auth, (req, res) => {
  const { entries } = req.body;
  const db = getDb();
  const ts = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(req.params.id);
  if (!ts) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ts.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (ts.status === 'approved') return res.status(400).json({ error: 'Cannot edit approved timesheet' });

  const update = db.prepare('UPDATE timesheet_entries SET start_time=?, end_time=?, hours=?, description=?, shift=?, lunch_break=? WHERE id=?');
  const txn = db.transaction(() => {
    for (const e of entries) {
      let hours = 0;
      const lunchBreak = parseFloat(e.lunch_break) || 0;
      if (e.start_time && e.end_time) {
        const [sh, sm] = e.start_time.split(':').map(Number);
        const [eh, em] = e.end_time.split(':').map(Number);
        hours = (eh * 60 + em - sh * 60 - sm) / 60;
        if (hours < 0) hours += 24;
        // Subtract lunch break from hours
        hours = Math.max(0, hours - lunchBreak);
      }
      update.run(e.start_time || null, e.end_time || null, hours, e.description || null, e.shift || 1, lunchBreak, e.id);
    }
  });
  txn();
  res.json({ success: true });
});

app.put('/api/timesheets/:id/submit', auth, async (req, res) => {
  const db = getDb();
  const ts = db.prepare(`
    SELECT ts.*, u.name as engineer_name, p.name as project_name, p.project_type, c.name as customer_name,
           ep.bill_rate,
           COALESCE((SELECT SUM(hours) FROM timesheet_entries WHERE timesheet_id = ts.id), 0) as total_hours
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.id = ?
  `).get(req.params.id);
  if (!ts) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ts.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE timesheets SET status='submitted', submitted_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);

  // Calculate amount based on project type
  const isFixedPrice = ts.project_type === 'fixed_price';
  const amount = isFixedPrice ? (ts.amount || 0) : (ts.total_hours * (ts.bill_rate || 0));

  // Send notification to admin
  const weekEnding = new Date(ts.week_ending + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const amountStr = `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  sendNotification(
    `Timesheet Submitted - ${ts.engineer_name}`,
    `
    <h2>New Timesheet Submitted</h2>
    <p>A timesheet has been submitted and is ready for your review.</p>
    <table style="border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Engineer:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.engineer_name}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Project:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.project_name}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Customer:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.customer_name}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Week Ending:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${weekEnding}</td></tr>
      ${isFixedPrice
        ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Percentage:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.percentage || 0}%</td></tr>`
        : `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Hours:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${ts.total_hours.toFixed(2)}</td></tr>`
      }
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${amountStr}</td></tr>
    </table>
    <p>Log in to <a href="https://timetracker.utechconsulting.net">UTech TimeTracker</a> to review and approve.</p>
    `,
    `Timesheet: ${ts.engineer_name} - ${ts.project_name} WE ${weekEnding} ${isFixedPrice ? ts.percentage + '%' : ts.total_hours.toFixed(1) + 'hrs'} ${amountStr}`
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

app.delete('/api/timesheets/:id', auth, (req, res) => {
  const db = getDb();
  const timesheet = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(req.params.id);

  if (!timesheet) {
    return res.status(404).json({ error: 'Timesheet not found' });
  }

  // Admins can delete any timesheet
  // Engineers can only delete their own draft timesheets
  if (req.user.role !== 'admin') {
    if (timesheet.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own timesheets' });
    }
    if (timesheet.status !== 'draft') {
      return res.status(403).json({ error: 'You can only delete timesheets that have not been submitted' });
    }
  }

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
           c.supplier_number, c.address as customer_address, c.payment_terms, cc.name as contact_name,
           (SELECT GROUP_CONCAT(DISTINCT u.name) FROM timesheets ts
            JOIN users u ON u.id = ts.user_id
            WHERE ts.project_id = i.project_id AND ts.status = 'approved') as engineers
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(invoices);
});

// Find projects with approved timesheets ready to invoice
// NOTE: This route MUST come before /api/invoices/:id to avoid matching :id = "find-ready"
app.get('/api/invoices/find-ready', auth, adminOnly, (req, res) => {
  const { period_start, period_end } = req.query;
  if (!period_start || !period_end) {
    return res.status(400).json({ error: 'period_start and period_end are required' });
  }

  const db = getDb();

  // Find all projects with approved timesheets in the date range
  const projects = db.prepare(`
    SELECT
      p.id, p.name as project_name, p.po_number, p.po_amount, p.project_type, p.total_cost,
      c.name as customer_name,
      COUNT(DISTINCT ts.id) as timesheet_count,
      COALESCE(SUM(CASE WHEN p.project_type = 'fixed_price' THEN ts.amount ELSE 0 END), 0) as fixed_amount,
      COALESCE(SUM(CASE WHEN p.project_type != 'fixed_price' THEN te.hours ELSE 0 END), 0) as total_hours,
      COALESCE(SUM(CASE WHEN p.project_type NOT IN ('fixed_price', 'fixed_monthly') THEN te.hours * ep.bill_rate ELSE 0 END), 0) as hourly_amount
    FROM projects p
    JOIN customers c ON c.id = p.customer_id
    JOIN timesheets ts ON ts.project_id = p.id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.status = 'approved'
    AND (
      (p.project_type != 'fixed_price' AND te.entry_date BETWEEN ? AND ?)
      OR (p.project_type = 'fixed_price' AND (
        ts.week_ending BETWEEN ? AND ?
        OR (ts.period_end IS NOT NULL AND ts.period_end BETWEEN ? AND ?)
      ))
    )
    GROUP BY p.id
    ORDER BY c.name, p.name
  `).all(period_start, period_end, period_start, period_end, period_start, period_end);

  // Calculate estimated invoice amount for each project
  const results = projects.map(p => {
    let estimated_amount;
    if (p.project_type === 'fixed_price') {
      const engineerTotals = db.prepare('SELECT SUM(total_payment) as total FROM engineer_projects WHERE project_id = ?').get(p.id);
      const totalEngineerPayments = engineerTotals?.total || 0;
      if (totalEngineerPayments > 0) {
        const percentageClaimed = p.fixed_amount / totalEngineerPayments;
        estimated_amount = percentageClaimed * (p.total_cost || 0);
      } else {
        estimated_amount = 0;
      }
    } else if (p.project_type === 'fixed_monthly') {
      const monthlyTotals = db.prepare('SELECT SUM(monthly_bill) as total FROM engineer_projects WHERE project_id = ?').get(p.id);
      estimated_amount = monthlyTotals?.total || 0;
    } else {
      estimated_amount = p.hourly_amount;
    }

    // Get engineers assigned to this project with approved timesheets in the period
    const engineers = db.prepare(`
      SELECT DISTINCT u.name
      FROM timesheets ts
      JOIN users u ON u.id = ts.user_id
      WHERE ts.project_id = ? AND ts.status = 'approved'
    `).all(p.id).map(e => e.name);

    // Check for existing non-voided invoice in same period
    const existingInvoice = db.prepare(`
      SELECT id, invoice_number FROM invoices
      WHERE project_id = ? AND voided_date IS NULL
      AND period_start = ? AND period_end = ?
    `).get(p.id, period_start, period_end);

    // Get remaining PO balance
    const billedSoFar = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total_billed
      FROM invoices WHERE project_id = ? AND voided_date IS NULL
    `).get(p.id);
    const po_amount = p.po_amount || 0;
    const total_billed = billedSoFar.total_billed || 0;
    const remaining_balance = po_amount > 0 ? po_amount - total_billed : null;
    const over_budget = po_amount > 0 && estimated_amount > (remaining_balance + 0.01);

    return {
      id: p.id,
      project_name: p.project_name,
      customer_name: p.customer_name,
      po_number: p.po_number,
      project_type: p.project_type,
      timesheet_count: p.timesheet_count,
      total_hours: p.total_hours,
      fixed_amount: p.fixed_amount,
      estimated_amount,
      engineers,
      existing_invoice: existingInvoice ? existingInvoice.invoice_number : null,
      po_amount,
      total_billed,
      remaining_balance,
      over_budget
    };
  });

  res.json(results);
});

app.get('/api/invoices/:id', auth, adminOnly, (req, res) => {
  try {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*, p.name as project_name, p.description as project_description, p.po_number, p.location,
           p.project_type, p.total_cost, p.include_timesheets,
           c.name as customer_name, c.address as customer_address, c.supplier_number, c.payment_terms,
           cc.name as contact_name
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });

  const isFixedPrice = invoice.project_type === 'fixed_price';
  const isFixedMonthly = invoice.project_type === 'fixed_monthly';

  // Get company settings
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  // Get line items from approved timesheets in the period
  // For hourly: find timesheets that have any entry_date in the period
  // For fixed price: use week_ending or period_end
  const timesheets = db.prepare(`
    SELECT DISTINCT ts.*, u.name as engineer_name, u.engineer_id, ep.bill_rate, ep.total_payment, ep.monthly_pay, ep.monthly_bill
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    WHERE ts.project_id = ? AND ts.status = 'approved'
    AND (
      (p.project_type NOT IN ('fixed_price') AND te.entry_date BETWEEN ? AND ?)
      OR (p.project_type = 'fixed_price' AND (
        ts.week_ending BETWEEN ? AND ?
        OR (ts.period_end IS NOT NULL AND ts.period_end BETWEEN ? AND ?)
      ))
    )
    ORDER BY ts.week_ending
  `).all(invoice.project_id, invoice.period_start, invoice.period_end, invoice.period_start, invoice.period_end, invoice.period_start, invoice.period_end);

  const lineItems = [];
  const timesheetDetails = [];

  // For fixed price projects, calculate based on project total cost
  let totalEngineerPayments = 0;
  let totalEngineerAmountClaimed = 0;

  if (isFixedPrice) {
    // Get total of all engineer payments for this project
    const engineerTotals = db.prepare('SELECT SUM(total_payment) as total FROM engineer_projects WHERE project_id = ?').get(invoice.project_id);
    totalEngineerPayments = engineerTotals?.total || 0;
  }

  for (const ts of timesheets) {
    if (isFixedPrice) {
      // Fixed price: calculate engineer's claimed amount
      let engineerAmt = ts.amount || 0;
      if ((engineerAmt === 0 || engineerAmt === null) && ts.percentage && ts.total_payment) {
        engineerAmt = (ts.percentage / 100) * ts.total_payment;
      }
      totalEngineerAmountClaimed += engineerAmt;

      if (engineerAmt > 0 || ts.percentage > 0) {
        lineItems.push({
          engineer: ts.engineer_name,
          percentage: ts.percentage,
          engineer_amount: engineerAmt,
          period_start: ts.period_start,
          period_end: ts.period_end,
          is_fixed_price: true
        });
        timesheetDetails.push({
          id: ts.id,
          engineer_name: ts.engineer_name,
          engineer_id: ts.engineer_id,
          percentage: ts.percentage,
          amount: engineerAmt,
          period_start: ts.period_start,
          period_end: ts.period_end,
          is_fixed_price: true
        });
      }
    } else if (isFixedMonthly) {
      // Fixed monthly: show hours worked but bill the fixed monthly amount per engineer
      const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date')
        .all(ts.id, invoice.period_start, invoice.period_end);
      const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
      if (hrs > 0) {
        // Check if we already have a line item for this engineer (aggregate hours, keep one monthly bill)
        const existing = lineItems.find(li => li.engineer === ts.engineer_name && li.is_fixed_monthly);
        if (existing) {
          existing.hours += hrs;
        } else {
          lineItems.push({
            engineer: ts.engineer_name,
            hours: hrs,
            rate: ts.monthly_bill || 0,
            amount: ts.monthly_bill || 0,
            is_fixed_monthly: true
          });
        }
        timesheetDetails.push({
          id: ts.id,
          engineer_name: ts.engineer_name,
          engineer_id: ts.engineer_id,
          week_ending: ts.week_ending,
          bill_rate: ts.monthly_bill,
          is_fixed_monthly: true,
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
    } else {
      // Hourly: calculate from entries within the invoice period only
      const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date')
        .all(ts.id, invoice.period_start, invoice.period_end);
      const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
      if (hrs > 0) {
        lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.bill_rate || 0, amount: hrs * (ts.bill_rate || 0), week_ending: ts.week_ending });
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
  }

  // For fixed price projects, calculate customer invoice based on project total cost
  if (isFixedPrice && totalEngineerPayments > 0) {
    const percentageClaimed = totalEngineerAmountClaimed / totalEngineerPayments;
    const customerInvoiceTotal = percentageClaimed * (invoice.total_cost || 0);

    lineItems.forEach(item => {
      if (item.is_fixed_price) {
        const engineerPortion = item.engineer_amount / totalEngineerAmountClaimed;
        item.amount = engineerPortion * customerInvoiceTotal;
      }
    });
  }

  res.json({ ...invoice, settings, lineItems, timesheetDetails, is_fixed_price: isFixedPrice, is_fixed_monthly: isFixedMonthly });
  } catch (err) {
    console.error('Error viewing invoice:', err);
    res.status(500).json({ error: err.message });
  }
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

    console.log('=== INVOICE GENERATION DEBUG ===');
    console.log('Project ID:', project_id);
    console.log('Period:', period_start, 'to', period_end);

    // Check project type
    const project = db.prepare(`
      SELECT p.*, p.description as project_description, c.name as customer_name, c.address as customer_address,
             c.supplier_number, c.payment_terms, cc.name as contact_name
      FROM projects p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN customer_contacts cc ON p.contact_id = cc.id
      WHERE p.id = ?
    `).get(project_id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log('Project type:', project.project_type);
    console.log('Project total_cost:', project.total_cost);
    const isFixedPrice = project.project_type === 'fixed_price';
    const isFixedMonthly = project.project_type === 'fixed_monthly';
    console.log('Is fixed price:', isFixedPrice, 'Is fixed monthly:', isFixedMonthly);

    const timesheets = db.prepare(`
      SELECT DISTINCT ts.*, u.name as engineer_name, u.engineer_id, ep.bill_rate, ep.pay_rate, ep.total_payment, ep.monthly_pay, ep.monthly_bill
      FROM timesheets ts
      JOIN users u ON u.id = ts.user_id
      JOIN projects p ON p.id = ts.project_id
      LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
      LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
      WHERE ts.project_id = ? AND ts.status = 'approved'
      AND (
        (p.project_type NOT IN ('fixed_price') AND te.entry_date BETWEEN ? AND ?)
        OR (p.project_type = 'fixed_price' AND (
          ts.week_ending BETWEEN ? AND ?
          OR (ts.period_end IS NOT NULL AND ts.period_end BETWEEN ? AND ?)
        ))
      )
      ORDER BY ts.week_ending
    `).all(project_id, period_start, period_end, period_start, period_end, period_start, period_end);

    console.log('Found timesheets:', timesheets.length);
    timesheets.forEach((ts, i) => {
      console.log(`Timesheet ${i}:`, {
        id: ts.id,
        status: ts.status,
        amount: ts.amount,
        percentage: ts.percentage,
        total_payment: ts.total_payment,
        period_start: ts.period_start,
        period_end: ts.period_end,
        week_ending: ts.week_ending
      });
    });

    let total_hours = 0, total_amount = 0;
    const lineItems = [];
    const timesheetDetails = [];

    // For fixed price projects, calculate based on project total cost
    let totalEngineerPayments = 0;
    let totalEngineerAmountClaimed = 0;

    if (isFixedPrice) {
      // Get total of all engineer payments for this project
      const engineerTotals = db.prepare('SELECT SUM(total_payment) as total FROM engineer_projects WHERE project_id = ?').get(project_id);
      totalEngineerPayments = engineerTotals?.total || 0;
      console.log('Total engineer payments budget:', totalEngineerPayments);
    }

    for (const ts of timesheets) {
      console.log('Processing timesheet:', ts.id, 'isFixedPrice:', isFixedPrice);
      if (isFixedPrice) {
        // Fixed price: calculate engineer's claimed amount
        let engineerAmt = ts.amount || 0;
        console.log('  Initial amt:', engineerAmt, 'percentage:', ts.percentage, 'total_payment:', ts.total_payment);
        if ((engineerAmt === 0 || engineerAmt === null) && ts.percentage && ts.total_payment) {
          engineerAmt = (ts.percentage / 100) * ts.total_payment;
          console.log('  Calculated engineer amt:', engineerAmt);
        }
        totalEngineerAmountClaimed += engineerAmt;

        if (engineerAmt > 0 || ts.percentage > 0) {
          lineItems.push({
            engineer: ts.engineer_name,
            percentage: ts.percentage,
            engineer_amount: engineerAmt,
            period_start: ts.period_start,
            period_end: ts.period_end,
            is_fixed_price: true
          });
          timesheetDetails.push({
            id: ts.id,
            engineer_name: ts.engineer_name,
            engineer_id: ts.engineer_id,
            percentage: ts.percentage,
            amount: engineerAmt,
            period_start: ts.period_start,
            period_end: ts.period_end,
            is_fixed_price: true
          });
        }
      } else if (isFixedMonthly) {
        // Fixed monthly: show hours but bill the fixed monthly amount per engineer
        const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date')
          .all(ts.id, period_start, period_end);
        const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
        total_hours += hrs;
        if (hrs > 0) {
          const existing = lineItems.find(li => li.engineer === ts.engineer_name && li.is_fixed_monthly);
          if (existing) {
            existing.hours += hrs;
          } else {
            lineItems.push({
              engineer: ts.engineer_name,
              hours: hrs,
              rate: ts.monthly_bill || 0,
              amount: ts.monthly_bill || 0,
              is_fixed_monthly: true
            });
            total_amount += (ts.monthly_bill || 0);
          }
          timesheetDetails.push({
            id: ts.id,
            engineer_name: ts.engineer_name,
            engineer_id: ts.engineer_id,
            week_ending: ts.week_ending,
            bill_rate: ts.monthly_bill,
            is_fixed_monthly: true,
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
      } else {
        // Hourly: calculate from entries within the invoice period only
        const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date')
          .all(ts.id, period_start, period_end);
        const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
        const amt = hrs * (ts.bill_rate || 0);
        total_hours += hrs;
        total_amount += amt;
        if (hrs > 0) {
          lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.bill_rate, amount: amt, week_ending: ts.week_ending });
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
    }

    // For fixed price projects, calculate customer invoice based on project total cost
    if (isFixedPrice && totalEngineerPayments > 0) {
      // What percentage of total engineer budget is being claimed?
      const percentageClaimed = totalEngineerAmountClaimed / totalEngineerPayments;
      // Apply that percentage to the project's total cost for customer invoice
      total_amount = percentageClaimed * (project.total_cost || 0);
      console.log('Engineer amount claimed:', totalEngineerAmountClaimed);
      console.log('Percentage of engineer budget:', (percentageClaimed * 100).toFixed(1) + '%');
      console.log('Project total cost:', project.total_cost);
      console.log('Customer invoice amount:', total_amount);

      // Update line items to show customer amount (proportional)
      lineItems.forEach(item => {
        if (item.is_fixed_price) {
          // Calculate this engineer's portion of the customer invoice
          const engineerPortion = item.engineer_amount / totalEngineerAmountClaimed;
          item.amount = engineerPortion * total_amount;
        }
      });
    }

    console.log('Final totals - hours:', total_hours, 'amount:', total_amount);
    console.log('Line items:', lineItems.length);
    console.log('=== END DEBUG ===');

    // Check for duplicate invoice: same project + overlapping period that isn't voided
    const existingInvoice = db.prepare(`
      SELECT id, invoice_number, period_start, period_end, status
      FROM invoices
      WHERE project_id = ? AND voided_date IS NULL
      AND period_start = ? AND period_end = ?
    `).get(project_id, period_start, period_end);
    if (existingInvoice) {
      return res.status(400).json({
        error: `Invoice #${existingInvoice.invoice_number} already exists for this project and period (${period_start} to ${period_end}). Void the existing invoice first if you need to recreate it.`
      });
    }

    // Budget check: ensure invoice amount doesn't exceed remaining PO balance
    if (project.po_amount > 0 && total_amount > 0) {
      const billedSoFar = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total_billed
        FROM invoices
        WHERE project_id = ? AND voided_date IS NULL
      `).get(project_id);
      const remaining = project.po_amount - (billedSoFar.total_billed || 0);
      if (total_amount > remaining + 0.01) {
        return res.status(400).json({
          error: `Invoice amount ${formatMoney(total_amount)} exceeds remaining PO balance of ${formatMoney(remaining)} (PO: ${formatMoney(project.po_amount)}, already billed: ${formatMoney(billedSoFar.total_billed || 0)}).`
        });
      }
    }

    // Get next invoice number from settings and increment
    const nextNumRow = db.prepare("SELECT value FROM settings WHERE key = 'next_invoice_number'").get();
    const nextNum = parseInt(nextNumRow?.value || '1000');
    const invoice_number = String(nextNum);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('next_invoice_number', ?)").run(String(nextNum + 1));

    const result = db.prepare('INSERT INTO invoices (project_id, invoice_number, period_start, period_end, total_hours, total_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(project_id, invoice_number, period_start, period_end, total_hours, total_amount, notes);

    // Get company settings
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }

    res.json({ id: result.lastInsertRowid, invoice_number, project, settings, total_hours, total_amount, lineItems, timesheetDetails, period_start, period_end, is_fixed_price: isFixedPrice, is_fixed_monthly: isFixedMonthly });
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

// Batch payment - record payment on multiple invoices at once
app.post('/api/invoices/batch-payment', auth, adminOnly, (req, res) => {
  const { invoice_ids, payment_date, payment_method, reference_number, notes } = req.body;
  if (!invoice_ids || !Array.isArray(invoice_ids) || invoice_ids.length === 0) {
    return res.status(400).json({ error: 'No invoices selected' });
  }

  const db = getDb();
  const results = [];
  const errors = [];

  const batchRun = db.transaction(() => {
    for (const invoiceId of invoice_ids) {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      if (!invoice) {
        errors.push({ id: invoiceId, error: 'Invoice not found' });
        continue;
      }
      if (invoice.status === 'voided') {
        errors.push({ id: invoiceId, invoice_number: invoice.invoice_number, error: 'Invoice is voided' });
        continue;
      }

      const balance = (invoice.total_amount || 0) - (invoice.amount_paid || 0);
      if (balance <= 0) {
        errors.push({ id: invoiceId, invoice_number: invoice.invoice_number, error: 'Already paid in full' });
        continue;
      }

      // Record payment for the full remaining balance
      db.prepare('INSERT INTO payments (invoice_id, amount, payment_date, payment_method, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(invoiceId, balance, payment_date, payment_method || null, reference_number || null, notes || null);

      // Update invoice to paid
      db.prepare('UPDATE invoices SET amount_paid = ?, status = ?, paid_date = ? WHERE id = ?')
        .run(invoice.total_amount, 'paid', payment_date, invoiceId);

      results.push({ id: invoiceId, invoice_number: invoice.invoice_number, amount: balance });
    }
  });

  batchRun();

  res.json({ success: true, paid: results, errors });
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

// Mark invoice as received (customer acknowledged receipt)
app.put('/api/invoices/:id/received', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  db.prepare('UPDATE invoices SET received_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Clear received status from invoice
app.put('/api/invoices/:id/unreceived', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  db.prepare('UPDATE invoices SET received_at = NULL WHERE id = ?').run(req.params.id);
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
  // Find timesheets that have entries in the invoice period
  const timesheets = db.prepare(`
    SELECT DISTINCT ts.*, u.name as engineer_name, u.engineer_id, ep.bill_rate, ep.monthly_bill, ep.monthly_pay, p.project_type
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    WHERE ts.project_id = ? AND ts.status = 'approved'
    AND te.entry_date BETWEEN ? AND ?
    ORDER BY ts.week_ending
  `).all(invoice.project_id, invoice.period_start, invoice.period_end);

  const lineItems = [];
  const timesheetDetails = [];
  const isFixedMonthly = timesheets.length > 0 && timesheets[0].project_type === 'fixed_monthly';
  for (const ts of timesheets) {
    const entries = db.prepare('SELECT * FROM timesheet_entries WHERE timesheet_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date')
      .all(ts.id, invoice.period_start, invoice.period_end);
    const hrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
    if (hrs > 0) {
      if (isFixedMonthly) {
        const existing = lineItems.find(li => li.engineer === ts.engineer_name);
        if (existing) {
          existing.hours += hrs;
        } else {
          lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.monthly_bill || 0, amount: ts.monthly_bill || 0, is_fixed_monthly: true });
        }
      } else {
        lineItems.push({ engineer: ts.engineer_name, hours: hrs, rate: ts.bill_rate || 0, amount: hrs * (ts.bill_rate || 0), week_ending: ts.week_ending });
      }
      timesheetDetails.push({
        engineer_name: ts.engineer_name,
        engineer_id: ts.engineer_id,
        week_ending: ts.week_ending,
        bill_rate: isFixedMonthly ? (ts.monthly_bill || 0) : ts.bill_rate,
        is_fixed_monthly: isFixedMonthly,
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
  const weekRange = (weekEnding) => {
    if (!weekEnding) return periodRange;
    const end = new Date(weekEnding.split('T')[0] + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return `${formatDate(start.toISOString().split('T')[0])} to ${formatDate(end.toISOString().split('T')[0])}`;
  };

  const hasHours = lineItems.some(item => item.hours > 0);
  const lineItemRows = lineItems.map(item => `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${item.hours.toFixed(2)}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.po_number || 'Engineering'}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${invoice.project_description || 'Engineering Labor Hours'} - ${item.engineer} - ${weekRange(item.week_ending)}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">$${item.rate.toFixed(2)}</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;"></td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">$${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  `).join('');
  const totalHoursRow = hasHours && lineItems.length > 1 ? `
    <tr style="border-top: 2px solid #000; font-weight: bold;">
      <td style="border: 1px solid #ccc; padding: 8px;">${lineItems.reduce((s, i) => s + (i.hours || 0), 0).toFixed(2)}</td>
      <td style="border: 1px solid #ccc; padding: 8px;" colspan="4">Total Hours</td>
      <td style="border: 1px solid #ccc; padding: 8px; text-align: right;">$${lineItems.reduce((s, i) => s + (i.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  ` : '';
  const lineItemsHtml = lineItems.length > 0 ? lineItemRows + totalHoursRow : `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${(invoice.total_hours || 0).toFixed(2)}</td>
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
      const isFixedMonthlyTs = ts.is_fixed_monthly;
      const rate = isFixedMonthlyTs ? 0 : (ts.bill_rate || 0);
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      // Build entries by date map
      const entriesByDate = {};
      ts.entries.forEach(e => {
        const dateKey = e.entry_date ? e.entry_date.split('T')[0] : '';
        if (dateKey) entriesByDate[dateKey] = e;
      });

      // Calculate week dates, filtered to billing month
      const weekEnd = new Date(ts.week_ending + 'T00:00:00');
      const allWeekDates = [];
      for (let i = -6; i <= 0; i++) {
        const d = new Date(weekEnd);
        d.setDate(weekEnd.getDate() + i);
        allWeekDates.push(d.toISOString().split('T')[0]);
      }
      // Filter to only dates within the invoice period
      const weekDates = allWeekDates.filter(date => date >= invoice.period_start && date <= invoice.period_end);

      // Calculate totals
      let totalST = 0;
      weekDates.forEach(date => {
        const entry = entriesByDate[date];
        if (entry && entry.hours) totalST += entry.hours;
      });
      const laborSubtotal = isFixedMonthlyTs ? (ts.bill_rate || 0) : (totalST * rate);

      // Build rows
      const rowsHtml = weekDates.map((date) => {
        const entry = entriesByDate[date] || {};
        const dateObj = new Date(date + 'T00:00:00');
        const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
        const hours = entry.hours || 0;
        const st = hours > 0 ? hours.toFixed(1) : '0.0';

        return `
          <tr>
            <td style="border: 1px solid #000; padding: 1px 2px; font-size: 6pt; text-align: center;">${formattedDate} ${dayName}</td>
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
              <div style="font-size: 5pt;">Mon shift 1 - Sun shift 3<br/>${isFixedMonthlyTs ? 'Fixed Monthly' : `$${rate.toFixed(2)}/hr`} | ST = All | OT/PT = N/A</div>
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
              <div style="text-align: right; padding: 0 2px; font-size: 5pt;">${isFixedMonthlyTs ? `Fixed Monthly | Hours: ${totalST.toFixed(1)}` : `Rate: $${rate.toFixed(2)}/hr | Hours: ${totalST.toFixed(1)}`}</div>
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

  // Get hourly timesheet payroll data
  const hourlyData = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id,
           u.holiday_pay_eligible, u.holiday_pay_rate,
           SUM(te.hours) as total_hours,
           ep.pay_rate,
           SUM(te.hours) * ep.pay_rate as total_pay,
           ep.bill_rate,
           SUM(te.hours) * ep.bill_rate as total_billed,
           p.name as project_name, p.po_number,
           'hourly' as pay_type
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.status = 'approved' AND p.project_type = 'hourly'
      AND te.entry_date BETWEEN ? AND ?
    GROUP BY u.id, p.id
    ORDER BY u.name, p.name
  `).all(period_start, period_end);

  // Get fixed monthly project payroll data
  const fixedMonthlyData = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id,
           u.holiday_pay_eligible, u.holiday_pay_rate,
           SUM(te.hours) as total_hours,
           ep.monthly_pay as pay_rate,
           ep.monthly_pay as total_pay,
           ep.monthly_bill as bill_rate,
           ep.monthly_bill as total_billed,
           p.name as project_name, p.po_number,
           'fixed_monthly' as pay_type
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.status = 'approved' AND p.project_type = 'fixed_monthly'
      AND te.entry_date BETWEEN ? AND ?
    GROUP BY u.id, p.id
    ORDER BY u.name, p.name
  `).all(period_start, period_end);

  // Get fixed price project payroll data
  const fixedPriceData = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id,
           u.holiday_pay_eligible, u.holiday_pay_rate,
           0 as total_hours,
           0 as pay_rate,
           ts.amount as total_pay,
           0 as bill_rate,
           ts.amount as total_billed,
           p.name as project_name, p.po_number,
           'fixed_price' as pay_type,
           ts.percentage
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.status = 'approved' AND p.project_type = 'fixed_price'
      AND ts.week_ending BETWEEN ? AND ?
    ORDER BY u.name, p.name
  `).all(period_start, period_end);

  const timesheetData = [...hourlyData, ...fixedMonthlyData, ...fixedPriceData];

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

  // Get uncleared advances for all engineers
  const unclearedAdvances = db.prepare(`
    SELECT ep.*, u.name as engineer_name
    FROM engineer_payments ep
    JOIN users u ON u.id = ep.user_id
    WHERE ep.payment_type = 'advance' AND ep.cleared = 0
    ORDER BY ep.payment_date
  `).all();

  res.json({ data, holidays, unclearedAdvances });
});

// ACH Export - Generate Chase CSV file for payroll (supports GET for backward compat and POST with overrides)
app.post('/api/payroll/ach-export', auth, adminOnly, (req, res) => {
  const { period_start, period_end, delivery_date, overrides } = req.body;
  req._achOverrides = overrides;
  req._achParams = { period_start, period_end, delivery_date };
  achExportHandler(req, res);
});
app.get('/api/payroll/ach-export', auth, adminOnly, (req, res) => {
  req._achParams = req.query;
  achExportHandler(req, res);
});
function achExportHandler(req, res) {
  const { period_start, period_end, delivery_date } = req._achParams;
  const overrides = req._achOverrides;
  const db = getDb();

  if (!delivery_date) {
    return res.status(400).json({ error: 'Delivery date is required' });
  }

  // Get Chase account from settings
  const chaseAccountSetting = db.prepare("SELECT value FROM settings WHERE key = 'chase_ach_account'").get();
  const chaseAccount = chaseAccountSetting?.value;
  if (!chaseAccount) {
    return res.status(400).json({ error: 'Chase ACH account not configured in settings' });
  }

  // Get hourly payroll data grouped by engineer (with split deposit info)
  const hourlyPayroll = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id,
           u.bank_routing, u.bank_account, u.bank_account_type,
           u.bank_routing_2, u.bank_account_2, u.bank_account_type_2,
           u.bank_pct_1, u.bank_pct_2,
           SUM(te.hours * ep.pay_rate) as total_pay
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.status = 'approved' AND p.project_type = 'hourly'
      AND te.entry_date BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY u.name
  `).all(period_start, period_end);

  // Get fixed monthly payroll data grouped by engineer
  const fixedMonthlyPayroll = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id,
           u.bank_routing, u.bank_account, u.bank_account_type,
           u.bank_routing_2, u.bank_account_2, u.bank_account_type_2,
           u.bank_pct_1, u.bank_pct_2,
           SUM(ep.monthly_pay) as total_pay
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.status = 'approved' AND p.project_type = 'fixed_monthly'
      AND te.entry_date BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY u.name
  `).all(period_start, period_end);

  // Get fixed price payroll data grouped by engineer
  const fixedPricePayroll = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id,
           u.bank_routing, u.bank_account, u.bank_account_type,
           u.bank_routing_2, u.bank_account_2, u.bank_account_type_2,
           u.bank_pct_1, u.bank_pct_2,
           SUM(ts.amount) as total_pay
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    WHERE ts.status = 'approved' AND p.project_type = 'fixed_price'
      AND ts.week_ending BETWEEN ? AND ?
    GROUP BY u.id
  `).all(period_start, period_end);

  // Merge fixed monthly and fixed price pay into hourly payroll
  const payrollData = [...hourlyPayroll];
  for (const fm of fixedMonthlyPayroll) {
    const existing = payrollData.find(p => p.user_id === fm.user_id);
    if (existing) {
      existing.total_pay = (existing.total_pay || 0) + (fm.total_pay || 0);
    } else {
      payrollData.push(fm);
    }
  }
  for (const fp of fixedPricePayroll) {
    const existing = payrollData.find(p => p.user_id === fp.user_id);
    if (existing) {
      existing.total_pay = (existing.total_pay || 0) + (fp.total_pay || 0);
    } else {
      payrollData.push(fp);
    }
  }

  // Add holiday pay for eligible engineers
  const holidays = db.prepare(`
    SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date
  `).all(period_start, period_end);
  const totalHolidayHours = holidays.reduce((sum, h) => sum + (h.hours || 8), 0);

  if (totalHolidayHours > 0) {
    const eligibleEngineers = db.prepare(`
      SELECT id, name, engineer_id, holiday_pay_rate,
             bank_routing, bank_account, bank_account_type,
             bank_routing_2, bank_account_2, bank_account_type_2,
             bank_pct_1, bank_pct_2
      FROM users
      WHERE holiday_pay_eligible = 1 AND holiday_pay_rate > 0
    `).all();

    for (const eng of eligibleEngineers) {
      const holidayPay = totalHolidayHours * eng.holiday_pay_rate;
      const existing = payrollData.find(p => p.user_id === eng.id);
      if (existing) {
        existing.total_pay = (existing.total_pay || 0) + holidayPay;
      } else {
        payrollData.push({
          user_id: eng.id,
          engineer_name: eng.name,
          engineer_id: eng.engineer_id,
          bank_routing: eng.bank_routing,
          bank_account: eng.bank_account,
          bank_account_type: eng.bank_account_type,
          bank_routing_2: eng.bank_routing_2,
          bank_account_2: eng.bank_account_2,
          bank_account_type_2: eng.bank_account_type_2,
          bank_pct_1: eng.bank_pct_1,
          bank_pct_2: eng.bank_pct_2,
          total_pay: holidayPay
        });
      }
    }
  }

  // Deduct uncleared advances from payroll
  const unclearedAdvances = db.prepare(`
    SELECT ep.id, ep.user_id, ep.amount
    FROM engineer_payments ep
    WHERE ep.payment_type = 'advance' AND ep.cleared = 0
  `).all();

  const advancesByUser = {};
  for (const adv of unclearedAdvances) {
    if (!advancesByUser[adv.user_id]) advancesByUser[adv.user_id] = { total: 0, ids: [] };
    advancesByUser[adv.user_id].total += adv.amount;
    advancesByUser[adv.user_id].ids.push(adv.id);
  }

  for (const payment of payrollData) {
    const advances = advancesByUser[payment.user_id];
    if (advances && advances.total > 0) {
      payment.advance_deduction = advances.total;
      payment.advance_ids = advances.ids;
      payment.gross_pay = payment.total_pay;
      payment.total_pay = Math.max(0, payment.total_pay - advances.total);
    }
  }

  // Apply overrides if provided (from POST with engineer selection/custom amounts)
  if (overrides && typeof overrides === 'object') {
    // Filter to only selected engineers and apply custom amounts
    const overrideNames = Object.keys(overrides);
    for (const payment of payrollData) {
      if (overrideNames.includes(payment.engineer_name)) {
        payment.total_pay = parseFloat(overrides[payment.engineer_name]) || 0;
      } else {
        payment.total_pay = 0; // Exclude unselected engineers
      }
    }
  }

  // Filter to only engineers with primary banking info and non-zero pay
  const validPayments = payrollData.filter(p =>
    p.bank_routing && p.bank_account && p.total_pay > 0
  );

  if (validPayments.length === 0) {
    return res.status(400).json({ error: 'No valid payments to export. Ensure engineers have banking info and approved timesheets.' });
  }

  // Build transaction list (handling split deposits)
  const transactions = [];
  for (const payment of validPayments) {
    const pct1 = payment.bank_pct_1 ?? 100;
    const pct2 = payment.bank_pct_2 ?? 0;
    const hasSplit = pct2 > 0 && payment.bank_routing_2 && payment.bank_account_2;

    // Primary account transaction
    const amount1 = hasSplit ? (payment.total_pay * pct1 / 100) : payment.total_pay;
    transactions.push({
      user_id: payment.user_id,
      engineer_name: payment.engineer_name,
      engineer_id: payment.engineer_id,
      bank_routing: payment.bank_routing,
      bank_account: payment.bank_account,
      bank_account_type: payment.bank_account_type || 'checking',
      amount: amount1,
      is_split: hasSplit,
      account_num: 1
    });

    // Secondary account transaction (if split)
    if (hasSplit) {
      const amount2 = payment.total_pay * pct2 / 100;
      transactions.push({
        user_id: payment.user_id,
        engineer_name: payment.engineer_name,
        engineer_id: payment.engineer_id,
        bank_routing: payment.bank_routing_2,
        bank_account: payment.bank_account_2,
        bank_account_type: payment.bank_account_type_2 || 'checking',
        amount: amount2,
        is_split: true,
        account_num: 2
      });
    }
  }

  // Format dates for Chase CSV (YYMMDD) - use Eastern timezone
  const now = new Date();
  // Convert to Eastern time (handles DST automatically)
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const year = eastern.getFullYear().toString().slice(2); // YY
  const month = (eastern.getMonth() + 1).toString().padStart(2, '0'); // MM
  const day = eastern.getDate().toString().padStart(2, '0'); // DD
  const hours = eastern.getHours().toString().padStart(2, '0'); // HH
  const minutes = eastern.getMinutes().toString().padStart(2, '0'); // MM
  const fileDate = `${year}${month}${day}`; // YYMMDD Eastern time
  const fileTime = `${hours}${minutes}`; // HHMM Eastern time

  // File ID modifier - single digit 0-9 (cycles based on minute)
  const fileIdModifier = (eastern.getMinutes() % 10).toString();

  // Delivery date - 2 days from file creation (at least 24 hours ahead), skip weekends
  const deliveryDate = new Date(eastern);
  deliveryDate.setDate(deliveryDate.getDate() + 2); // Add 2 days
  // If Saturday, move to Monday
  if (deliveryDate.getDay() === 6) {
    deliveryDate.setDate(deliveryDate.getDate() + 2);
  }
  // If Sunday, move to Monday
  if (deliveryDate.getDay() === 0) {
    deliveryDate.setDate(deliveryDate.getDate() + 1);
  }
  const delYear = deliveryDate.getFullYear().toString().slice(2);
  const delMonth = (deliveryDate.getMonth() + 1).toString().padStart(2, '0');
  const delDay = deliveryDate.getDate().toString().padStart(2, '0');
  const deliveryYYMMDD = `${delYear}${delMonth}${delDay}`;

  // Get month/year for addenda (based on period end date)
  const periodEndDate = new Date(period_end + 'T00:00:00');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const addendaText = `${monthNames[periodEndDate.getMonth()]} ${periodEndDate.getFullYear()} Invoice`;

  // Calculate totals
  const totalAmount = transactions.reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
  const transactionCount = transactions.length;

  // Build CSV rows
  const rows = [];

  // Row 1: File Header
  rows.push([
    '1',                              // Indicator
    fileIdModifier,                   // File ID modifier (single digit 0-9)
    fileDate,                         // File creation date (YYMMDD)
    fileTime,                         // File creation time (HHMM)
    transactionCount.toString(),      // Total transactions
    totalAmount.toString(),           // Total credit amount (in cents)
    '0',                              // Total debit amount
    '1'                               // Batch count
  ].join(','));

  // Row 5: Batch Header
  rows.push([
    '5',                              // Indicator
    '220',                            // Service class code (220 = credits)
    chaseAccount,                     // Chase account number
    'PPD',                            // SEC code (PPD for payroll)
    'PAYROLL',                        // Entry description
    deliveryYYMMDD,                   // Delivery date (YYMMDD)
    totalAmount.toString(),           // Batch credit amount
    '0',                              // Batch debit amount
    '100',                            // Batch number
    transactionCount.toString()       // Transactions in batch
  ].join(','));

  // Row 6: Transaction details
  transactions.forEach((trxn, index) => {
    const trxnCode = trxn.bank_account_type === 'savings' ? '32' : '22';
    const amountCents = Math.round(trxn.amount * 100);
    const payeeName = trxn.engineer_name.slice(0, 22).replace(/,/g, ''); // Max 22 chars, no commas
    // ID Number: use engineer_id without hyphen (ENG001 format), alphanumeric only
    const idNumber = (trxn.engineer_id || `EMP${trxn.user_id}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    const traceId = (100 * 1000 + index + 1).toString(); // 100001, 100002, etc.

    rows.push([
      '6',                            // Indicator
      trxnCode,                       // Transaction code (22=checking, 32=savings)
      trxn.bank_routing,              // Routing number
      trxn.bank_account,              // Account number
      amountCents.toString(),         // Amount in cents
      idNumber,                       // ID number (engineer name, alphanumeric)
      payeeName,                      // Payee name
      traceId,                        // Trace ID
      addendaText                     // Addenda (Month Year Invoice)
    ].join(','));
  });

  // Auto-record engineer payments when ACH is generated (skip duplicates)
  const existingCheck = db.prepare(
    'SELECT id FROM engineer_payments WHERE user_id = ? AND payment_type = ? AND period_start = ? AND period_end = ?'
  );
  const insertPayment = db.prepare(
    'INSERT INTO engineer_payments (user_id, amount, payment_date, payment_type, period_start, period_end, reference_number, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const achRef = `ACH_${fileDate}`;
  for (const payment of validPayments) {
    const existing = existingCheck.get(payment.user_id, 'payroll', period_start, period_end);
    if (!existing) {
      insertPayment.run(
        payment.user_id, payment.total_pay, delivery_date,
        'payroll', period_start, period_end,
        achRef, 'ACH', `ACH payroll for ${period_start} to ${period_end}`
      );
    }
  }

  // Mark advances as cleared for ALL engineers in this payroll run (including $0 net pay)
  const clearAdvance = db.prepare(
    "UPDATE engineer_payments SET cleared = 1, cleared_payroll_period = ? WHERE id = ?"
  );
  const payrollPeriod = `${period_start} to ${period_end}`;
  for (const payment of payrollData) {
    if (payment.advance_ids && payment.advance_ids.length > 0) {
      for (const advId of payment.advance_ids) {
        clearAdvance.run(payrollPeriod, advId);
      }
    }
  }

  // Return CSV
  const csv = rows.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="ACH_Payroll_${fileDate}.csv"`);
  res.send(csv);
}

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
  const { year, start_date, end_date } = req.query;

  let dateStart, dateEnd;
  if (start_date && end_date) {
    dateStart = start_date;
    dateEnd = end_date;
  } else {
    const targetYear = year || new Date().getFullYear();
    dateStart = `${targetYear}-01-01`;
    dateEnd = `${targetYear}-12-31`;
  }

  // Get all timesheets for this engineer in the date range
  // Support both hourly (week_ending) and fixed price (period_end) timesheets
  const timesheets = db.prepare(`
    SELECT ts.id, ts.week_ending, ts.status, ts.period_start, ts.period_end, ts.percentage, ts.amount as fixed_amount,
           p.id as project_id, p.name as project_name, p.project_type, c.name as customer_name,
           COALESCE(SUM(CASE WHEN te.entry_date BETWEEN ? AND ? THEN te.hours ELSE 0 END), 0) as total_hours,
           ep.pay_rate, ep.total_payment, ep.monthly_pay, ep.monthly_bill,
           CASE
             WHEN p.project_type = 'fixed_price' THEN ts.amount
             WHEN p.project_type = 'fixed_monthly' THEN ep.monthly_pay
             ELSE COALESCE(SUM(CASE WHEN te.entry_date BETWEEN ? AND ? THEN te.hours ELSE 0 END), 0) * COALESCE(ep.pay_rate, 0)
           END as amount
    FROM timesheets ts
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE ts.user_id = ?
    AND (
      (p.project_type != 'fixed_price' AND EXISTS (
        SELECT 1 FROM timesheet_entries te2 WHERE te2.timesheet_id = ts.id AND te2.entry_date BETWEEN ? AND ?
      ))
      OR (p.project_type = 'fixed_price' AND (
        ts.week_ending BETWEEN ? AND ?
        OR (ts.period_end IS NOT NULL AND ts.period_end BETWEEN ? AND ?)
      ))
    )
    GROUP BY ts.id
    ORDER BY p.name, ts.week_ending, ts.period_end
  `).all(dateStart, dateEnd, dateStart, dateEnd, req.user.id, dateStart, dateEnd, dateStart, dateEnd, dateStart, dateEnd);

  // Calculate totals
  const approvedSheets = timesheets.filter(t => t.status === 'approved');
  const totalHours = approvedSheets.reduce((s, t) => s + (t.total_hours || 0), 0);
  const totalEarnings = approvedSheets.reduce((s, t) => s + (t.amount || 0), 0);
  const pendingHours = timesheets.filter(t => t.status !== 'approved').reduce((s, t) => s + (t.total_hours || 0), 0);
  const pendingAmount = timesheets.filter(t => t.status !== 'approved').reduce((s, t) => s + (t.amount || 0), 0);

  // Group by project for the report view
  const byProject = {};
  for (const ts of timesheets) {
    if (!byProject[ts.project_id]) {
      byProject[ts.project_id] = {
        project_name: ts.project_name,
        customer_name: ts.customer_name,
        project_type: ts.project_type,
        timesheets: [],
        total_hours: 0,
        total_amount: 0
      };
    }
    byProject[ts.project_id].timesheets.push(ts);
    if (ts.status === 'approved') {
      byProject[ts.project_id].total_hours += ts.total_hours || 0;
      byProject[ts.project_id].total_amount += ts.amount || 0;
    }
  }

  res.json({
    start_date: dateStart,
    end_date: dateEnd,
    timesheets,
    byProject: Object.values(byProject),
    summary: {
      total_hours: totalHours,
      total_earnings: totalEarnings,
      pending_hours: pendingHours,
      pending_amount: pendingAmount
    }
  });
});

// Hours Summary: hours per engineer per project for a date range (uses individual entry dates)
app.get('/api/reports/hours-summary', auth, adminOnly, (req, res) => {
  const db = getDb();
  const { period_start, period_end } = req.query;
  if (!period_start || !period_end) {
    return res.status(400).json({ error: 'period_start and period_end are required' });
  }
  const rows = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name,
           p.id as project_id, p.name as project_name,
           c.id as customer_id, c.name as customer_name,
           p.project_type,
           COALESCE(SUM(te.hours), 0) as total_hours,
           COUNT(DISTINCT ts.id) as timesheet_count
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE te.entry_date >= ? AND te.entry_date <= ?
      AND te.hours > 0
      AND ts.status IN ('draft', 'submitted', 'approved')
    GROUP BY u.id, p.id
    ORDER BY u.name, p.name
  `).all(period_start, period_end);
  res.json(rows);
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

// Contract hours report - shows remaining hours (single engineer) or dollars (multiple)
app.get('/api/reports/contract-hours', auth, adminOnly, (req, res) => {
  const db = getDb();

  // Get all active hourly projects with their budget info
  const projects = db.prepare(`
    SELECT p.id, p.name as project_name, p.po_number, p.po_amount, p.project_type,
           c.name as customer_name,
           COALESCE((SELECT SUM(te.hours) FROM timesheet_entries te
                     JOIN timesheets ts ON ts.id = te.timesheet_id
                     WHERE ts.project_id = p.id AND ts.status = 'approved'), 0) as hours_billed,
           COALESCE((SELECT SUM(te.hours * ep2.bill_rate) FROM timesheet_entries te
                     JOIN timesheets ts ON ts.id = te.timesheet_id
                     JOIN engineer_projects ep2 ON ep2.project_id = p.id AND ep2.user_id = ts.user_id
                     WHERE ts.project_id = p.id AND ts.status = 'approved'), 0) as amount_billed
    FROM projects p
    JOIN customers c ON c.id = p.customer_id
    WHERE p.status = 'active' AND p.project_type = 'hourly'
    ORDER BY c.name, p.name
  `).all();

  // For each project, get assigned engineers
  const result = projects.map(p => {
    const engineers = db.prepare(`
      SELECT ep.user_id, u.name as engineer_name, ep.bill_rate
      FROM engineer_projects ep
      JOIN users u ON u.id = ep.user_id
      WHERE ep.project_id = ?
    `).all(p.id);

    const engineerCount = engineers.length;
    const remaining_dollars = p.po_amount - p.amount_billed;

    let remaining_hours = null;
    let single_engineer = null;
    let bill_rate = null;

    if (engineerCount === 1 && engineers[0].bill_rate > 0) {
      bill_rate = engineers[0].bill_rate;
      remaining_hours = remaining_dollars / bill_rate;
      single_engineer = engineers[0].engineer_name;
    }

    return {
      ...p,
      engineer_count: engineerCount,
      engineers: engineers.map(e => e.engineer_name).join(', '),
      single_engineer,
      bill_rate,
      remaining_dollars,
      remaining_hours
    };
  });

  res.json(result);
});

app.get('/api/reports/overdue-invoices', auth, adminOnly, (req, res) => {
  const db = getDb();
  const invoices = db.prepare(`
    SELECT i.*, p.name as project_name, p.po_number,
           c.name as customer_name, c.payment_terms
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE i.status IN ('unpaid', 'partial') AND i.voided_date IS NULL
    ORDER BY i.created_at
  `).all();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = invoices.map(inv => {
    const terms = inv.payment_terms || 'Net 30';
    let days = 30;
    if (terms === 'Immediate') { days = 0; }
    else { const m = terms.match(/Net\s*(\d+)/i); if (m) days = parseInt(m[1], 10); }

    const created = new Date(inv.created_at.replace(' ', 'T'));
    const dueDate = new Date(created);
    dueDate.setDate(dueDate.getDate() + days);
    dueDate.setHours(0, 0, 0, 0);

    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
    const balance = (inv.total_amount || 0) - (inv.amount_paid || 0);

    return {
      ...inv,
      due_date: dueDate.toISOString().split('T')[0],
      days_overdue: daysOverdue,
      balance,
      aging: daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+',
    };
  });

  res.json(results);
});

// ─── IMPORT BANKING INFO ──────────────────────────────────────────────────────

// Import banking info from CSV data
app.post('/api/import/banking', auth, adminOnly, (req, res) => {
  const { csvData } = req.body;
  const db = getDb();

  if (!csvData || !csvData.trim()) {
    return res.status(400).json({ error: 'No CSV data provided' });
  }

  try {
    // Parse CSV
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must have header row and at least one data row' });
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const vendors = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx]?.trim() || '';
      });
      vendors.push(row);
    }

    // Get all engineers
    const engineers = db.prepare("SELECT id, name FROM users WHERE role = 'engineer'").all();

    // Build name lookup (normalized)
    function normalizeName(name) {
      return name.toLowerCase().replace(/[^a-z]/g, '');
    }
    const engineerMap = {};
    engineers.forEach(eng => {
      engineerMap[normalizeName(eng.name)] = eng;
    });

    // Identify split deposits vs single deposits
    const splitDeposits = {};
    const singleDeposits = [];

    vendors.forEach(v => {
      const name = v.VendorName || v.Name || '';
      const nickname = v.VendorNickname || v.Nickname || name;
      const accountType = (v.BankAccountType || v.AccountType || 'checking').toLowerCase();
      const routing = v.BankRoutingNumber || v.RoutingNumber || '';
      const account = v.BankAccountNumber || v.AccountNumber || '';

      // Check for percentage in name (split deposit indicator)
      const pctMatch = name.match(/(\d+)\s*percent/i) || name.match(/-\s*(\d+)%/);

      if (pctMatch) {
        const baseName = nickname.replace(/\s*(checking|savings|\d+\s*percent|-\s*\d+%)/gi, '').trim();
        const normalizedBase = normalizeName(baseName);

        if (!splitDeposits[normalizedBase]) {
          splitDeposits[normalizedBase] = { baseName, accounts: [] };
        }
        splitDeposits[normalizedBase].accounts.push({
          pct: parseInt(pctMatch[1]),
          type: accountType,
          routing,
          account
        });
      } else {
        singleDeposits.push({ name: nickname, type: accountType, routing, account });
      }
    });

    // Prepare update statements
    const updateSingle = db.prepare(`
      UPDATE users SET
        bank_routing = ?, bank_account = ?, bank_account_type = ?,
        bank_pct_1 = 100, bank_pct_2 = 0
      WHERE id = ?
    `);

    const updateSplit = db.prepare(`
      UPDATE users SET
        bank_routing = ?, bank_account = ?, bank_account_type = ?,
        bank_routing_2 = ?, bank_account_2 = ?, bank_account_type_2 = ?,
        bank_pct_1 = ?, bank_pct_2 = ?
      WHERE id = ?
    `);

    const results = { updated: [], notFound: [], splits: [] };

    // Process single deposits
    singleDeposits.forEach(v => {
      const normalized = normalizeName(v.name);
      const engineer = engineerMap[normalized];

      if (engineer && v.routing && v.account) {
        updateSingle.run(v.routing, v.account, v.type, engineer.id);
        results.updated.push({ name: engineer.name, account: '...' + v.account.slice(-4) });
      } else if (!engineer) {
        results.notFound.push(v.name);
      }
    });

    // Process split deposits
    Object.entries(splitDeposits).forEach(([normalizedBase, data]) => {
      const engineer = engineerMap[normalizedBase];

      if (engineer && data.accounts.length >= 2) {
        data.accounts.sort((a, b) => b.pct - a.pct);
        const primary = data.accounts[0];
        const secondary = data.accounts[1];

        updateSplit.run(
          primary.routing, primary.account, primary.type,
          secondary.routing, secondary.account, secondary.type,
          primary.pct, secondary.pct,
          engineer.id
        );
        results.updated.push({
          name: engineer.name,
          account: '...' + primary.account.slice(-4),
          split: `${primary.pct}%/${secondary.pct}%`
        });
        results.splits.push(engineer.name);
      } else if (!engineer) {
        results.notFound.push(data.baseName);
      }
    });

    res.json({
      success: true,
      message: `Updated ${results.updated.length} engineers`,
      updated: results.updated,
      notFound: results.notFound,
      splitDeposits: results.splits
    });

  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ENGINEER PAYMENTS ────────────────────────────────────────────────────────

// List engineer payments with filters
app.get('/api/engineer-payments', auth, adminOnly, (req, res) => {
  const db = getDb();
  const { user_id, period_start, period_end, payment_type } = req.query;
  let query = `
    SELECT ep.*, u.name as engineer_name, u.engineer_id
    FROM engineer_payments ep
    JOIN users u ON u.id = ep.user_id
    WHERE 1=1
  `;
  const params = [];
  if (user_id) { query += ' AND ep.user_id = ?'; params.push(user_id); }
  if (period_start && period_end) {
    query += ' AND (ep.payment_date BETWEEN ? AND ? OR (ep.period_start IS NOT NULL AND ep.period_end IS NOT NULL AND ep.period_start <= ? AND ep.period_end >= ?))';
    params.push(period_start, period_end, period_end, period_start);
  } else if (period_start) {
    query += ' AND (ep.payment_date >= ? OR ep.period_end >= ?)'; params.push(period_start, period_start);
  } else if (period_end) {
    query += ' AND (ep.payment_date <= ? OR ep.period_start <= ?)'; params.push(period_end, period_end);
  }
  if (payment_type) { query += ' AND ep.payment_type = ?'; params.push(payment_type); }
  query += ' ORDER BY ep.payment_date DESC, ep.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// Create an engineer payment
app.post('/api/engineer-payments', auth, adminOnly, (req, res) => {
  const { user_id, amount, payment_date, payment_type, period_start, period_end, reference_number, payment_method, notes } = req.body;
  if (!user_id || !amount || !payment_date || !payment_type) {
    return res.status(400).json({ error: 'user_id, amount, payment_date, and payment_type are required' });
  }
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO engineer_payments (user_id, amount, payment_date, payment_type, period_start, period_end, reference_number, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(user_id, amount, payment_date, payment_type, period_start || null, period_end || null, reference_number || null, payment_method || null, notes || null);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Toggle cleared status on an advance payment
app.put('/api/engineer-payments/:id/clear', auth, adminOnly, (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM engineer_payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.payment_type !== 'advance') return res.status(400).json({ error: 'Only advance payments can be cleared' });

  const { cleared, cleared_payroll_period } = req.body;
  db.prepare('UPDATE engineer_payments SET cleared = ?, cleared_payroll_period = ? WHERE id = ?')
    .run(cleared ? 1 : 0, cleared ? (cleared_payroll_period || null) : null, req.params.id);
  res.json({ success: true });
});

// Delete an engineer payment
app.delete('/api/engineer-payments/:id', auth, adminOnly, (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM engineer_payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  db.prepare('DELETE FROM engineer_payments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 1099 Summary - totals per engineer for a tax year
app.get('/api/engineer-payments/1099-summary', auth, adminOnly, (req, res) => {
  const db = getDb();
  const { year } = req.query;
  const taxYear = year || new Date().getFullYear();
  const startDate = `${taxYear}-01-01`;
  const endDate = `${taxYear}-12-31`;
  const data = db.prepare(`
    SELECT u.id as user_id, u.name as engineer_name, u.engineer_id, u.email,
           COALESCE(SUM(ep.amount), 0) as total_paid,
           COUNT(ep.id) as payment_count,
           MIN(ep.payment_date) as first_payment,
           MAX(ep.payment_date) as last_payment
    FROM users u
    LEFT JOIN engineer_payments ep ON ep.user_id = u.id AND (
      ep.payment_date BETWEEN ? AND ?
      OR (ep.period_start IS NOT NULL AND ep.period_end IS NOT NULL AND ep.period_start <= ? AND ep.period_end >= ?)
    )
    WHERE u.role = 'engineer'
    GROUP BY u.id
    HAVING total_paid > 0
    ORDER BY u.name
  `).all(startDate, endDate, endDate, startDate);
  res.json(data);
});

// Payment verification letter data
app.get('/api/engineer-payments/verification/:userId', auth, adminOnly, (req, res) => {
  const db = getDb();
  const { period_start, period_end } = req.query;
  const user = db.prepare('SELECT id, name, engineer_id, email, created_at FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Engineer not found' });

  const startDate = period_start || `${new Date().getFullYear()}-01-01`;
  const endDate = period_end || new Date().toISOString().split('T')[0];

  const payments = db.prepare(`
    SELECT amount, payment_date, payment_type, period_start, period_end
    FROM engineer_payments
    WHERE user_id = ? AND (
      payment_date BETWEEN ? AND ?
      OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_start <= ? AND period_end >= ?)
    )
    ORDER BY payment_date
  `).all(req.params.userId, startDate, endDate, endDate, startDate);

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const months = new Set(payments.map(p => p.payment_date.substring(0, 7))).size || 1;
  const avgMonthly = totalPaid / months;

  // Get company info from settings
  const settings = {};
  db.prepare("SELECT key, value FROM settings").all().forEach(s => { settings[s.key] = s.value; });

  res.json({
    engineer: user,
    period: { start: startDate, end: endDate },
    total_paid: totalPaid,
    payment_count: payments.length,
    avg_monthly: avgMonthly,
    months_active: months,
    payments,
    company: {
      name: settings.company_name || '',
      address: settings.company_address || '',
      phone: settings.company_phone || '',
      email: settings.company_email || '',
    }
  });
});

// ─── BACKUP & RESTORE ─────────────────────────────────────────────────────────

// Backup all company data
app.get('/api/backup', auth, adminOnly, (req, res) => {
  const db = getDb();
  try {
    const backup = {
      version: '1.0',
      created_at: new Date().toISOString(),
      data: {
        customers: db.prepare('SELECT * FROM customers').all(),
        customer_contacts: db.prepare('SELECT * FROM customer_contacts').all(),
        projects: db.prepare('SELECT * FROM projects').all(),
        users: db.prepare('SELECT id, name, email, password, role, engineer_id, holiday_pay_eligible, holiday_pay_rate, bank_routing, bank_account, bank_account_type, bank_routing_2, bank_account_2, bank_account_type_2, bank_pct_1, bank_pct_2, created_at FROM users').all(),
        engineer_projects: db.prepare('SELECT * FROM engineer_projects').all(),
        timesheets: db.prepare('SELECT * FROM timesheets').all(),
        timesheet_entries: db.prepare('SELECT * FROM timesheet_entries').all(),
        invoices: db.prepare('SELECT * FROM invoices').all(),
        payments: db.prepare('SELECT * FROM payments').all(),
        settings: db.prepare('SELECT * FROM settings').all(),
        holidays: db.prepare('SELECT * FROM holidays').all(),
        engineer_payments: db.prepare('SELECT * FROM engineer_payments').all(),
      }
    };

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
    // Disable foreign key checks during restore
    db.pragma('foreign_keys = OFF');

    const txn = db.transaction(() => {
      // Clear existing data (except current admin user)
      const currentUserId = req.user.id;
      db.prepare('DELETE FROM engineer_payments').run();
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
      db.prepare('DELETE FROM holidays').run();

      // Restore customers
      if (backup.data.customers) {
        for (const c of backup.data.customers) {
          db.prepare('INSERT INTO customers (id, name, contact, email, phone, address, supplier_number, payment_terms, ap_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            c.id, c.name, c.contact, c.email, c.phone, c.address, c.supplier_number, c.payment_terms, c.ap_email || null, c.created_at
          );
        }
      }

      // Restore customer_contacts
      if (backup.data.customer_contacts) {
        for (const c of backup.data.customer_contacts) {
          db.prepare('INSERT INTO customer_contacts (id, customer_id, name, title, email, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            c.id, c.customer_id, c.name, c.title, c.email, c.phone, c.created_at || null
          );
        }
      }

      // Restore projects
      if (backup.data.projects) {
        for (const p of backup.data.projects) {
          db.prepare('INSERT INTO projects (id, customer_id, contact_id, name, description, po_number, po_amount, location, status, include_timesheets, project_type, total_cost, requires_daily_logs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            p.id, p.customer_id, p.contact_id, p.name, p.description, p.po_number, p.po_amount, p.location, p.status, p.include_timesheets ?? 1, p.project_type || 'hourly', p.total_cost || 0, p.requires_daily_logs || 0, p.created_at
          );
        }
      }

      // Restore users (except current admin) - preserve original passwords
      if (backup.data.users) {
        for (const u of backup.data.users) {
          if (u.id === currentUserId) continue;
          db.prepare(`INSERT INTO users (id, name, email, password, role, engineer_id, holiday_pay_eligible, holiday_pay_rate,
            bank_routing, bank_account, bank_account_type, bank_routing_2, bank_account_2, bank_account_type_2, bank_pct_1, bank_pct_2, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            u.id, u.name, u.email, u.password, u.role, u.engineer_id, u.holiday_pay_eligible || 0, u.holiday_pay_rate || 0,
            u.bank_routing || null, u.bank_account || null, u.bank_account_type || 'checking',
            u.bank_routing_2 || null, u.bank_account_2 || null, u.bank_account_type_2 || 'checking',
            u.bank_pct_1 ?? 100, u.bank_pct_2 ?? 0, u.created_at
          );
        }
      }

      // Restore engineer_projects
      if (backup.data.engineer_projects) {
        for (const ep of backup.data.engineer_projects) {
          db.prepare('INSERT OR IGNORE INTO engineer_projects (id, user_id, project_id, pay_rate, bill_rate, total_payment, monthly_pay, monthly_bill, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            ep.id, ep.user_id, ep.project_id, ep.pay_rate, ep.bill_rate, ep.total_payment || 0, ep.monthly_pay || 0, ep.monthly_bill || 0, ep.created_at || null
          );
        }
      }

      // Restore timesheets
      if (backup.data.timesheets) {
        for (const t of backup.data.timesheets) {
          db.prepare('INSERT INTO timesheets (id, user_id, project_id, week_ending, status, submitted_at, approved_at, approved_by, period_start, period_end, percentage, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            t.id, t.user_id, t.project_id, t.week_ending, t.status, t.submitted_at, t.approved_at, t.approved_by, t.period_start, t.period_end, t.percentage || 0, t.amount || 0, t.created_at
          );
        }
      }

      // Restore timesheet_entries
      if (backup.data.timesheet_entries) {
        for (const e of backup.data.timesheet_entries) {
          db.prepare('INSERT INTO timesheet_entries (id, timesheet_id, entry_date, start_time, end_time, hours, description, shift, lunch_break, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            e.id, e.timesheet_id, e.entry_date, e.start_time, e.end_time, e.hours, e.description, e.shift, e.lunch_break || 0, e.created_at || null
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

      // Restore holidays
      if (backup.data.holidays) {
        for (const h of backup.data.holidays) {
          db.prepare('INSERT INTO holidays (id, name, date, hours, created_at) VALUES (?, ?, ?, ?, ?)').run(
            h.id, h.name, h.date, h.hours || 8, h.created_at
          );
        }
      }

      if (backup.data.engineer_payments) {
        for (const ep of backup.data.engineer_payments) {
          db.prepare('INSERT INTO engineer_payments (id, user_id, amount, payment_date, payment_type, period_start, period_end, reference_number, payment_method, notes, cleared, cleared_payroll_period, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            ep.id, ep.user_id, ep.amount, ep.payment_date, ep.payment_type, ep.period_start, ep.period_end, ep.reference_number, ep.payment_method, ep.notes, ep.cleared || 0, ep.cleared_payroll_period || null, ep.created_at
          );
        }
      }
    });

    txn();
    db.pragma('foreign_keys = ON');
    res.json({ success: true, message: 'Backup restored successfully. All data and passwords preserved.' });
  } catch (err) {
    db.pragma('foreign_keys = ON');
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
