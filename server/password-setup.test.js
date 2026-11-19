const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const setup = require('./password-setup');

const NOW = new Date('2026-11-18T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, password TEXT, active INTEGER DEFAULT 1)");
  db.prepare("INSERT INTO users (id, name, email, password) VALUES (1, 'Ana Ruiz', 'ana@example.com', 'old-hash')").run();
  setup.migratePasswordSetup(db);
  return db;
}

test('a new link finds its user and stores only a hash of the token', () => {
  const db = makeDb();
  const token = setup.createSetupToken(db, 1, NOW);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(setup.findSetupUser(db, token, NOW), { id: 1, name: 'Ana Ruiz', email: 'ana@example.com' });
  const stored = db.prepare('SELECT token_hash FROM password_setup_tokens').get().token_hash;
  assert.notStrictEqual(stored, token);
});

test('a link stops working after 7 days', () => {
  const db = makeDb();
  const token = setup.createSetupToken(db, 1, NOW);
  assert.ok(setup.findSetupUser(db, token, new Date(NOW.getTime() + 6 * DAY_MS)));
  assert.strictEqual(setup.findSetupUser(db, token, new Date(NOW.getTime() + 8 * DAY_MS)), null);
});

test('sending a new link cancels the earlier one', () => {
  const db = makeDb();
  const first = setup.createSetupToken(db, 1, NOW);
  const second = setup.createSetupToken(db, 1, NOW);
  assert.strictEqual(setup.findSetupUser(db, first, NOW), null);
  assert.ok(setup.findSetupUser(db, second, NOW));
});

test('setting a password saves it and uses up the link', () => {
  const db = makeDb();
  const token = setup.createSetupToken(db, 1, NOW);
  const user = setup.setPasswordWithToken(db, token, 'correct horse', NOW);
  assert.strictEqual(user.email, 'ana@example.com');
  const hash = db.prepare('SELECT password FROM users WHERE id = 1').get().password;
  assert.ok(bcrypt.compareSync('correct horse', hash));
  assert.throws(() => setup.setPasswordWithToken(db, token, 'another pass', NOW), setup.PasswordSetupError);
});

test('rejects a short password without using up the link', () => {
  const db = makeDb();
  const token = setup.createSetupToken(db, 1, NOW);
  assert.throws(() => setup.setPasswordWithToken(db, token, 'short', NOW), /at least 8/);
  assert.ok(setup.findSetupUser(db, token, NOW));
});

test('rejects unknown links and inactive users', () => {
  const db = makeDb();
  assert.throws(() => setup.setPasswordWithToken(db, 'f'.repeat(64), 'long enough', NOW), setup.PasswordSetupError);
  assert.strictEqual(setup.findSetupUser(db, 'not-a-token', NOW), null);
  const token = setup.createSetupToken(db, 1, NOW);
  db.prepare('UPDATE users SET active = 0 WHERE id = 1').run();
  assert.strictEqual(setup.findSetupUser(db, token, NOW), null);
});

test('the welcome email has the site, username and link, with the name escaped', () => {
  const email = setup.buildWelcomeEmail({
    name: '<b>Ana</b> Ruiz', email: 'ana@example.com',
    link: 'https://timetracker.utechconsulting.net/?setup=abc', siteUrl: 'https://timetracker.utechconsulting.net', companyName: 'UTech',
  });
  assert.match(email.subject, /UTech TimeTracker/);
  assert.match(email.html, /Hi &lt;b&gt;Ana&lt;\/b&gt;,/);
  assert.match(email.html, /ana@example\.com/);
  assert.match(email.html, /href="https:\/\/timetracker\.utechconsulting\.net\/\?setup=abc"/);
  assert.match(email.text, /7 days/);
});

test('links point at the site the admin is using only when it is a known address', () => {
  assert.strictEqual(setup.resolveSiteUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.strictEqual(setup.resolveSiteUrl('https://evil.example.com'), setup.DEFAULT_SITE_URL);
  assert.strictEqual(setup.resolveSiteUrl(undefined), setup.DEFAULT_SITE_URL);
});
