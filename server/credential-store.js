const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const CRED_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'esupplier-credentials.enc');

function deriveKey(passphrase) {
  const salt = Buffer.from('timetracker-esupplier-salt', 'utf8');
  return crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
}

function encrypt(data, passphrase) {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex'),
  };
}

function decrypt(encData, passphrase) {
  const key = deriveKey(passphrase);
  const iv = Buffer.from(encData.iv, 'hex');
  const authTag = Buffer.from(encData.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

function saveCredentials(credentials, passphrase) {
  const dir = path.dirname(CRED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const encData = encrypt(credentials, passphrase);
  fs.writeFileSync(CRED_FILE, JSON.stringify(encData), 'utf8');
}

function loadCredentials(passphrase) {
  if (!fs.existsSync(CRED_FILE)) return null;
  const encData = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  return decrypt(encData, passphrase);
}

function hasCredentials() {
  return fs.existsSync(CRED_FILE);
}

module.exports = { saveCredentials, loadCredentials, hasCredentials };
