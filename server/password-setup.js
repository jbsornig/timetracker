// One-time "set your password" links for welcome emails.
//
// The emailed token is random; only its SHA-256 hash is stored, so a copy of the database
// cannot be used to set anyone's password. Each user has at most one live link, and a link
// works once, for SETUP_LINK_DAYS days.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SETUP_LINK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const TOKEN_BYTES = 32;
const BCRYPT_ROUNDS = 10;
const DEFAULT_SITE_URL = 'https://timetracker.utechconsulting.net';
const LOCAL_SITE_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

class PasswordSetupError extends Error {}

function migratePasswordSetup(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_setup_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createSetupToken(db, userId, now = new Date()) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(now.getTime() + SETUP_LINK_DAYS * DAY_MS).toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM password_setup_tokens WHERE user_id = ? AND used_at IS NULL').run(userId);
    db.prepare('INSERT INTO password_setup_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
      .run(userId, hashToken(token), expiresAt);
  })();
  return token;
}

function findTokenRow(db, token, now) {
  const row = db.prepare(`
    SELECT t.id AS token_id, t.expires_at, t.used_at, u.id, u.name, u.email, u.active
    FROM password_setup_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
  `).get(hashToken(token));
  if (!row || row.used_at || row.active === 0 || new Date(row.expires_at) <= now) return null;
  return row;
}

// The user a link belongs to, or null when the link is unknown, used, expired or the user is inactive.
function findSetupUser(db, token, now = new Date()) {
  const row = findTokenRow(db, token, now);
  return row ? { id: row.id, name: row.name, email: row.email } : null;
}

function setPasswordWithToken(db, token, password, now = new Date()) {
  const row = findTokenRow(db, token, now);
  if (!row) throw new PasswordSetupError('This link has expired or was already used. Ask your administrator to send a new one.');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordSetupError(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, BCRYPT_ROUNDS), row.id);
    db.prepare('UPDATE password_setup_tokens SET used_at = ? WHERE id = ?').run(now.toISOString(), row.token_id);
  })();
  return { id: row.id, name: row.name, email: row.email };
}

// Links point at the site the admin is using (so local testing stays local), but only
// for known addresses; anything else falls back to the production site.
function resolveSiteUrl(origin) {
  if (origin === DEFAULT_SITE_URL || LOCAL_SITE_PATTERN.test(origin || '')) return origin;
  return DEFAULT_SITE_URL;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildWelcomeEmail({ name, email, link, siteUrl, companyName }) {
  const company = companyName || 'UTech Consulting';
  const firstName = String(name || '').trim().split(/\s+/)[0] || 'there';
  const subject = `Welcome to UTech TimeTracker - set your password`;
  const text = [
    `Hi ${firstName},`,
    '',
    `${company} has set up your UTech TimeTracker account. You'll use it to enter your time and see your earnings.`,
    '',
    `1. Set your password: ${link}`,
    `2. Sign in at ${siteUrl} with your email (${email}) and the password you chose.`,
    '',
    `The link works once and expires in ${SETUP_LINK_DAYS} days. If it expires, ask us to send a new one.`,
    '',
    company,
  ].join('\n');
  const cell = 'padding: 10px 14px; border: 1px solid #e2e8f0;';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; color: #1e293b;">
      <h2 style="margin-bottom: 4px;">Welcome to UTech TimeTracker</h2>
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>${escapeHtml(company)} has set up your TimeTracker account. You'll use it to enter your time and see your earnings.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(link)}" style="background: #2563eb; color: #ffffff; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: 600;">Set your password</a>
      </p>
      <p>After that, sign in any time with:</p>
      <table style="border-collapse: collapse; margin: 8px 0 16px;">
        <tr><td style="${cell} font-weight: 600; background: #f8fafc;">Website</td><td style="${cell}"><a href="${escapeHtml(siteUrl)}">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
        <tr><td style="${cell} font-weight: 600; background: #f8fafc;">Email</td><td style="${cell}">${escapeHtml(email)}</td></tr>
        <tr><td style="${cell} font-weight: 600; background: #f8fafc;">Password</td><td style="${cell}">The one you choose</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">The button works once and expires in ${SETUP_LINK_DAYS} days. If it expires, ask us to send a new one.</p>
      <p style="font-size: 13px; color: #64748b;">If the button doesn't work, copy this address into your browser:<br>${escapeHtml(link)}</p>
      <p style="font-size: 13px; color: #64748b;">${escapeHtml(company)}</p>
    </div>
  `;
  return { subject, html, text };
}

module.exports = {
  migratePasswordSetup, createSetupToken, findSetupUser, setPasswordWithToken,
  resolveSiteUrl, buildWelcomeEmail, PasswordSetupError, DEFAULT_SITE_URL, SETUP_LINK_DAYS,
};
