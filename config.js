'use strict';

/**
 * Configuration + a dependency-free .env loader.
 */

const path = require('path');
const fs = require('fs');

function loadEnvFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* no .env — fine */
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const ROOT = __dirname;

function list(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? '/tmp/blackmamerstudio-data' : path.join(ROOT, 'data');
const ADMIN_ACCOUNT_ID = '900000000000000001';

const config = {
  root: ROOT,
  isVercel: IS_VERCEL,
  port: Number(process.env.PORT) || 3000,
  baseUrl,
  sessionSecret: process.env.SESSION_SECRET || 'blackmamerstudio-dev-secret-change-me',
  keySecret: process.env.KEY_SECRET || process.env.SESSION_SECRET || 'blackmamerstudio-dev-key-secret-change-me',

  dataDir: DATA_DIR,
  outDir: path.join(DATA_DIR, 'out'),
  tmpDir: path.join(DATA_DIR, 'tmp'),

  discord: {
    // Same Discord application the reference login URL points at.
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: process.env.DISCORD_REDIRECT_URI || `${baseUrl}/api/auth/callback/discord`,
    scopes: list(process.env.DISCORD_SCOPES || 'identify email guilds'),
    get configured() {
      return Boolean(process.env.DISCORD_CLIENT_ID);
    },
    get allowDevLogin() {
      if (process.env.ALLOW_DEV_LOGIN === '1') return true;
      if (process.env.ALLOW_DEV_LOGIN === '0') return false;
      return !process.env.DISCORD_CLIENT_ID && !process.env.DISCORD_CLIENT_SECRET && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl);
    },
  },

  adminIds: [...list(process.env.ADMIN_USER_IDS || ''), ...(process.env.ADMIN_PASSWORD ? [ADMIN_ACCOUNT_ID] : [])],

  /** Built-in admin account (username + password login, no Discord needed). */
  adminLogin: {
    id: ADMIN_ACCOUNT_ID,
    username: process.env.ADMIN_USERNAME || 'blackmamer',
    password: process.env.ADMIN_PASSWORD || '',
    get enabled() {
      return Boolean(process.env.ADMIN_PASSWORD);
    },
  },

  /**
   * Plan catalogue — mirrors the pricing section of the reference site.
   * `priceIdr` is what the pricing card shows.
   */
  plans: {
    free: {
      id: 'free',
      priceIdr: 0,
      days: null,
      label: { en: 'Free', id: 'Free' },
      conversionsPerDay: 2,
      maxFileMb: 200,
      batchSize: 1,
      speedControl: false,
      prioritySupport: false,
      albumOfAccepted: false,
      unlimited: false,
    },
    '7d': {
      id: '7d',
      priceIdr: 85000,
      days: 7,
      label: { en: '7 Days', id: '7 Hari' },
      conversionsPerDay: null,
      maxFileMb: 200,
      batchSize: 1,
      speedControl: true,
      prioritySupport: true,
      albumOfAccepted: false,
      unlimited: true,
    },
    '30d': {
      id: '30d',
      priceIdr: 180000,
      days: 30,
      label: { en: '30 Days', id: '30 Hari' },
      conversionsPerDay: null,
      maxFileMb: 200,
      batchSize: 5,
      speedControl: true,
      prioritySupport: true,
      albumOfAccepted: false,
      unlimited: true,
    },
    '90d': {
      id: '90d',
      priceIdr: 450000,
      priceBeforeIdr: 540000,
      days: 90,
      label: { en: '3 Months', id: '3 Bulan' },
      conversionsPerDay: null,
      maxFileMb: 200,
      batchSize: 5,
      speedControl: true,
      prioritySupport: true,
      albumOfAccepted: true,
      unlimited: true,
    },
  },

  /** Speed presets exposed by the converter UI. */
  presets: {
    slow: { id: 'slow', label: { en: 'Slow', id: 'Lambat' }, speed: 0.7, amplify: -3 },
    default: { id: 'default', label: { en: 'Default', id: 'Default' }, speed: 1, amplify: 0 },
    fast: { id: 'fast', label: { en: 'Fast', id: 'Cepat' }, speed: 1.5, amplify: -1 },
    faster: { id: 'faster', label: { en: 'Faster', id: 'Lebih Cepat' }, speed: 2.3, amplify: -2 },
    ultra: { id: 'ultra', label: { en: 'Ultra', id: 'Ultra' }, speed: 3, amplify: -4 },
  },

  /** Roblox hard limits that drive auto-split. */
  roblox: {
    maxAssetSeconds: 7 * 60,
    apiKey: process.env.ROBLOX_API_KEY || '',
  },

  midtrans: {
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
    isProduction: process.env.MIDTRANS_PRODUCTION === '1',
    get configured() {
      return Boolean(process.env.MIDTRANS_SERVER_KEY);
    },
  },

  /** Ordered list of Open Cloud scopes shown on the security section. */
  scopes: [
    'universe-datastores.objects:read',
    'universe-datastores.objects:create',
    'universe-datastores.objects:update',
    'universe-messaging-service:publish',
  ],
};

module.exports = config;
