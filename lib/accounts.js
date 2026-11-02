'use strict';

/**
 * Own account system: register + login with username/password,
 * locked to the first device (random device id) and optionally the first IP.
 */

const crypto = require('crypto');
const store = require('./store');

const BIND_IP = process.env.BIND_IP === '1';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function sha(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function validName(u) {
  return /^[a-z0-9_.]{3,24}$/.test(u);
}

function normalize(u) {
  return String(u || '').trim().toLowerCase();
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

function deviceHash(device) {
  const d = String(device || '');
  if (d.length < 16 || d.length > 200) return null;
  return sha(d);
}

function register(req, { username, password, device }) {
  const name = normalize(username);
  if (!validName(name)) return { error: 'Username 3-24 karakter: huruf kecil, angka, _ atau .' };
  if (String(password || '').length < 8) return { error: 'Password minimal 8 karakter.' };
  const dh = deviceHash(device);
  if (!dh) return { error: 'Device ID tidak valid. Refresh halaman lalu coba lagi.' };

  const db = store.load();
  if (db.accounts[name]) return { error: 'Username sudah dipakai.' };
  if (name === 'admin' || name === 'blackmamer') return { error: 'Username itu dicadangkan.' };

  // One account per device.
  if (Object.values(db.accounts).some((a) => a.device === dh)) {
    return { error: 'Device ini sudah punya akun. Login pakai akun tersebut.' };
  }

  const userId = '8' + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
  const { salt, hash } = hashPassword(password);
  db.accounts[name] = {
    username: name,
    userId,
    salt,
    hash,
    device: dh,
    ip: clientIp(req),
    createdAt: new Date().toISOString(),
  };
  const user = store.upsertUser({ id: userId, username: name, global_name: name });
  store.save();
  return { user };
}

function login(req, { username, password, device }) {
  const name = normalize(username);
  const db = store.load();
  const acc = db.accounts[name];
  const fail = { error: 'Username atau password salah.' };
  if (!acc) return fail;
  const { hash } = hashPassword(password, acc.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(acc.hash, 'hex'))) return fail;

  const dh = deviceHash(device);
  if (dh && !acc.device) {
    // After an admin reset: bind to whichever device logs in next.
    acc.device = dh;
    acc.ip = clientIp(req);
    store.save();
  }
  if (!dh || dh !== acc.device) {
    return { error: 'Login ditolak: akun ini terkunci ke device lain. Minta admin reset device.', code: 'DEVICE_MISMATCH' };
  }
  if (BIND_IP && acc.ip && acc.ip !== clientIp(req)) {
    return { error: 'Login ditolak: IP berbeda dari yang terdaftar. Minta admin reset.', code: 'IP_MISMATCH' };
  }
  const user = store.getUser(acc.userId);
  if (!user) return fail;
  if (user.blocked) return { error: 'Account blocked.' };
  return { user };
}

/** Admin: clear the device/IP lock; next login from any device re-binds. */
function resetDevice(username) {
  const acc = store.load().accounts[normalize(username)];
  if (!acc) return false;
  acc.device = null;
  acc.ip = null;
  store.save();
  return true;
}

module.exports = { register, login, resetDevice, BIND_IP };
