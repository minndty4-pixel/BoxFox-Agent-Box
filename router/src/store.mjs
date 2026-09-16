import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assert } from './errors.mjs';

export function defaultDataDir() {
  return process.env.BOXFOX_ROUTER_DATA_DIR || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'BoxFox', 'router') : join(homedir(), '.local', 'share', 'boxfox', 'router'));
}
export class RouterStore {
  constructor({ dataDir = defaultDataDir() } = {}) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
      const account = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
      assert(account, 'Cannot determine owner for credential storage.');
      const secured = spawnSync('icacls.exe', [dataDir, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe' });
      assert(secured.status === 0, 'Cannot protect the host credential directory.');
    } else chmodSync(dataDir, 0o700);
    const keyPath = join(dataDir, 'master.key');
    const databasePath = join(dataDir, 'router.sqlite');
    if (!existsSync(keyPath)) {
      assert(!existsSync(databasePath), 'Credential encryption key is missing. Restore the key before opening this database.');
      try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    this.masterKey = readFileSync(keyPath);
    assert(this.masterKey.length === 32, 'Invalid host credential key.');
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, encrypted TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO records VALUES (?, ?, ?)').run('config', 'default', JSON.stringify({ connectionId: null, modelId: null, aliasId: null }));
  }
  get(kind, id) { const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.body) : null; }
  list(kind) { return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.body)); }
  put(kind, value) { this.db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(kind, value.id, JSON.stringify(value)); return value; }
  delete(kind, id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  getDefault() { const { id: _id, ...value } = this.get('config', 'default'); return value; }
  setDefault(value) { this.put('config', { ...value, id: 'default' }); return value; }
  saveCredentials(id, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    cipher.setAAD(Buffer.from(id));
    const content = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const encrypted = Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
    this.db.prepare('INSERT OR REPLACE INTO credentials VALUES (?,?)').run(id, encrypted);
  }
  credentials(id) {
    const row = this.db.prepare('SELECT encrypted FROM credentials WHERE id=?').get(id);
    if (!row) return null;
    const data = Buffer.from(row.encrypted, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.masterKey, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
  }
  removeCredentials(id) { this.db.prepare('DELETE FROM credentials WHERE id=?').run(id); }
  addKey(name, allowedModels) {
    const key = `bf_${randomBytes(32).toString('base64url')}`;
    const record = { id: randomUUID(), name, prefix: key.slice(0, 11), allowedModels, enabled: true, createdAt: new Date().toISOString(), lastUsedAt: null, hash: createHash('sha256').update(key).digest('hex') };
    this.put('key', record);
    return { key, record: this.publicKey(record) };
  }
  publicKey({ hash: _hash, ...key }) { return key; }
  authenticateKey(key) {
    if (!key || key.length > 300) return null;
    const hash = createHash('sha256').update(key).digest('hex');
    const match = this.list('key').find(k => k.enabled && k.hash === hash);
    if (!match) return null;
    match.lastUsedAt = new Date().toISOString(); this.put('key', match); return match;
  }
  addUsage(value) {
    this.put('usage', { ...value, id: randomUUID(), createdAt: new Date().toISOString() });
    this.db.prepare("DELETE FROM records WHERE kind='usage' AND rowid NOT IN (SELECT rowid FROM records WHERE kind='usage' ORDER BY rowid DESC LIMIT 2000)").run();
  }
  close() { this.db.close(); this.masterKey.fill(0); }
}
