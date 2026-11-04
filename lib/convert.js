'use strict';

/**
 * Audio pipeline: ffmpeg/ffprobe wrappers.
 *
 * Everything the UI exposes is applied here so the produced file is genuinely
 * playable: speed preset, derived amplification, loudness normalisation and the
 * Roblox 7-minute auto-split.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function resolveBinary(envKey, binName, installerModule) {
  const candidates = [];
  if (process.env[envKey]) candidates.push(process.env[envKey]);
  candidates.push(path.join(__dirname, '..', 'bin', binName));
  try {
    candidates.push(require(installerModule).path);
  } catch {
    /* optional */
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).size > 1024 * 1024) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return binName.replace(/\.exe$/i, '');
}

const FFMPEG = resolveBinary('FFMPEG_PATH', 'ffmpeg.exe', '@ffmpeg-installer/ffmpeg');
const FFPROBE = resolveBinary('FFPROBE_PATH', 'ffprobe.exe', '@ffprobe-installer/ffprobe');

function run(bin, args, { timeout = 10 * 60 * 1000, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timer = null;

    if (timeout) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${path.basename(bin)} timed out`));
      }, timeout);
    }

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      if (onStderr) onStderr(chunk);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        if (process.env.YTDLP_DEBUG) console.error(`[${path.basename(bin)} stderr]\n${stderr}`);
        const errLines = stderr.split('\n').filter((l) => /^(ERROR|WARNING):/i.test(l.trim()));
        const summary = errLines.length ? errLines.slice(-3).join(' | ') : stderr.slice(-400);
        reject(new Error(`${path.basename(bin)} exited ${code}: ${summary.slice(0, 600)}`));
      }
    });
  });
}

/* ------------------------------------------------------------------- probe */

async function probe(file) {
  const { stdout } = await run(
    FFPROBE,
    [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate,format_name:stream=codec_name,channels,sample_rate',
      '-of', 'json',
      file,
    ],
    { timeout: 30000 }
  );

  const data = JSON.parse(stdout || '{}');
  const stream = (data.streams || [])[0] || {};
  const format = data.format || {};

  return {
    durationSec: Number.parseFloat(format.duration) || 0,
    bitrate: Number.parseInt(format.bit_rate, 10) || 0,
    formatName: format.format_name || '',
    codec: stream.codec_name || '',
    channels: stream.channels || 0,
    sampleRate: Number.parseInt(stream.sample_rate, 10) || 0,
  };
}

/* ---------------------------------------------------------------- amplitude */

/**
 * "Amplification is derived for you" — a speed change alters perceived
 * loudness, so we compensate with a fixed dB offset instead of asking the user.
 */
function deriveAmplify(speed) {
  const s = Math.min(3, Math.max(0.5, Number(speed) || 1));
  if (Math.abs(s - 1) < 0.001) return 0;
  const db = -20 * Math.log10(s);
  return Math.round(db * 10) / 10;
}

/* ------------------------------------------------------------------ convert */

/**
 * @param {string} input
 * @param {string} output
 * @param {{speed?:number, amplify?:number, normalize?:boolean, format?:string}} options
 */
async function convert(input, output, options = {}) {
  const speed = Math.min(3, Math.max(0.5, Number(options.speed) || 1));
  const amplify =
    options.amplify === undefined || options.amplify === null
      ? deriveAmplify(speed)
      : Math.min(20, Math.max(-30, Number(options.amplify)));

  const filters = [];
  if (Math.abs(speed - 1) > 0.001) filters.push(`atempo=${speed.toFixed(4)}`);
  if (Math.abs(amplify) > 0.01) filters.push(`volume=${amplify}dB`);
  if (options.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input];
  if (filters.length) args.push('-af', filters.join(','));
  args.push('-vn', '-map_metadata', '-1');

  // Roblox ingests OGG/Vorbis most reliably.
  args.push('-c:a', 'libvorbis', '-qscale:a', '6', '-ar', '44100');
  args.push(output);

  await run(FFMPEG, args, { timeout: 15 * 60 * 1000 });

  const stat = fs.statSync(output);
  const info = await probe(output);
  return { filePath: output, bytes: stat.size, durationSec: info.durationSec, speed, amplify };
}

/* -------------------------------------------------------------------- split */

/**
 * Auto-Split for Roblox: cut into <= maxSeconds parts on packet boundaries.
 * @returns {Promise<{index:number, filePath:string, durationSec:number}[]>}
 */
async function split(input, outDir, maxSeconds = 7 * 60) {
  const info = await probe(input);
  if (info.durationSec <= maxSeconds + 1) {
    return [{ index: 1, filePath: input, durationSec: info.durationSec }];
  }

  const base = path.basename(input, path.extname(input));
  const pattern = path.join(outDir, `${base}-part%03d.ogg`);

  await run(
    FFMPEG,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-f', 'segment',
      '-segment_time', String(maxSeconds),
      '-reset_timestamps', '1',
      '-c', 'copy',
      pattern,
    ],
    { timeout: 15 * 60 * 1000 }
  );

  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith(`${base}-part`) && f.endsWith('.ogg'))
    .sort();

  const parts = [];
  for (let i = 0; i < files.length; i += 1) {
    const filePath = path.join(outDir, files[i]);
    const partInfo = await probe(filePath);
    parts.push({ index: i + 1, filePath, durationSec: partInfo.durationSec });
  }
  return parts;
}

/* ------------------------------------------------------------------ extract */

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const os = require('os');

/**
 * YouTube blocks most datacenter IPs ("Sign in to confirm you're not a bot").
 * The reliable fixes are (1) cookies exported from your own logged-in account and
 * (2) a residential/ISP proxy. Both are optional env vars:
 *
 *   YTDLP_COOKIES       Netscape cookies.txt content (raw, or base64-encoded)
 *   YTDLP_COOKIES_FILE  path to a cookies.txt (alternative to the above)
 *   YTDLP_PROXY         e.g. http://user:pass@host:port or socks5://host:port
 *   YTDLP_PLAYER_CLIENTS  optional comma list for youtube player_client (default: yt-dlp decides)
 *   YTDLP_EXTRA_ARGS    extra raw yt-dlp flags, space separated
 */
let cookieFileCache = null;
function cookieFile() {
  if (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)) {
    return process.env.YTDLP_COOKIES_FILE;
  }
  const raw = process.env.YTDLP_COOKIES;
  if (!raw) return null;
  if (cookieFileCache && fs.existsSync(cookieFileCache)) return cookieFileCache;

  let text = raw.trim();
  if (!/^#|\t/.test(text.slice(0, 200))) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      /* treat as raw */
    }
  }
  text = text.replace(/\\n/g, '\n');
  // yt-dlp rewrites the cookie jar, so it must live on a writable path.
  const file = path.join(os.tmpdir(), `ytdlp-cookies-${process.pid}.txt`);
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600 });
  cookieFileCache = file;
  return file;
}

function ytdlpBaseArgs(clientsOverride) {
  const args = ['--no-warnings', '--no-playlist'];
  const cookies = cookieFile();
  if (cookies) args.push('--cookies', cookies);
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  // Only override yt-dlp's own client choice when explicitly asked (e.g. "tv,web_safari").
  const clients = clientsOverride || process.env.YTDLP_PLAYER_CLIENTS;
  if (clients) args.push('--extractor-args', `youtube:player_client=${clients}`);
  if (process.env.YTDLP_DEBUG) args.push('-v');
  args.push('--retries', '3', '--socket-timeout', '20');
  // Recent yt-dlp needs a JS runtime to solve YouTube's signature challenge.
  // Node is already present in this image (set YTDLP_JS_RUNTIME=none to disable).
  const jsRuntime = process.env.YTDLP_JS_RUNTIME || 'node';
  if (jsRuntime !== 'none') args.push('--js-runtimes', jsRuntime);
  if (process.env.YTDLP_EXTRA_ARGS) args.push(...process.env.YTDLP_EXTRA_ARGS.split(/\s+/).filter(Boolean));
  return args;
}

function friendlyYtdlpError(err) {
  const msg = String((err && err.message) || err || '');
  if (/not a bot|sign in to confirm|confirm you.re not|cookies-from-browser|use --cookies/i.test(msg)) {
    const e = new Error(
      process.env.YTDLP_COOKIES || process.env.YTDLP_COOKIES_FILE
        ? 'YouTube menolak cookies yang terpasang (kemungkinan expired). Export cookies baru lalu update YTDLP_COOKIES.'
        : 'YouTube meminta verifikasi bot dari IP server. Pasang cookies akun (YTDLP_COOKIES) atau proxy residential (YTDLP_PROXY), atau upload file audio langsung.'
    );
    e.code = 'YT_BOT_CHECK';
    return e;
  }
  if (/ENOENT|not found|spawn yt-dlp/i.test(msg)) {
    const e = new Error('yt-dlp tidak terinstall di server ini (Vercel serverless tidak bisa). Jalankan di VPS/Render/Docker dengan yt-dlp.');
    e.code = 'YTDLP_MISSING';
    return e;
  }
  return err;
}

async function extract(url, outDir, onProgress) {
  const template = path.join(outDir, 'source.%(ext)s');

  if (onProgress) onProgress(10, 'Reading source metadata…');

  // yt-dlp shells out to ffmpeg for post-processing; point it at ours so it
  // works even when ffmpeg is not on PATH.
  const ffmpegLocation = FFMPEG.includes(path.sep) ? path.dirname(FFMPEG) : null;

  const attempt = async (clients) => {
    const args = [
      ...ytdlpBaseArgs(clients),
      '--format', 'bestaudio/best',
      '--extract-audio',
      '--audio-format', 'best',
      '--audio-quality', '0',
      '--output', template,
      '--print', 'after_move:filepath',
    ];
    if (ffmpegLocation) args.push('--ffmpeg-location', ffmpegLocation);
    args.push(url);

    await run(YTDLP, args, {
      timeout: 8 * 60 * 1000,
      onStderr: (chunk) => {
        const m = chunk.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (m && onProgress) onProgress(10 + Number(m[1]) * 0.5, 'Downloading source audio…');
      },
    });
  };

  // YouTube sometimes returns no audio formats for one client but works for another.
  const tries = [undefined, 'web_safari', 'tv', 'mweb', 'web'];
  let lastErr;
  for (const clients of tries) {
    try {
      await attempt(clients);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (!/format is not available|no video formats|only images/i.test(String(err.message))) break;
      console.error(`[yt-dlp extract] client=${clients || 'default'} failed: ${err.message}`);
    }
  }
  if (lastErr) throw friendlyYtdlpError(lastErr);

  const files = fs.readdirSync(outDir).filter((f) => f.startsWith('source.'));
  if (!files.length) throw new Error('Source audio could not be downloaded.');
  return path.join(outDir, files[0]);
}

async function metadata(url) {
  try {
    const { stdout } = await run(
      YTDLP,
      [...ytdlpBaseArgs(), '--ignore-no-formats-error', '--print', '%(title)s\t%(uploader)s\t%(duration)s\t%(thumbnail)s', url],
      { timeout: 45000 }
    );
    const [title, uploader, duration, thumbnail] = stdout.trim().split('\t');
    return {
      title: title || '',
      artist: uploader || '',
      durationSec: Number.parseFloat(duration) || 0,
      thumbnail: thumbnail || '',
    };
  } catch (err) {
    const friendly = friendlyYtdlpError(err);
    if (friendly.code) throw friendly;
    console.error('[yt-dlp metadata]', err.message);
    const line = String(err.message).split('\n').reverse().find((l) => /ERROR:/i.test(l)) || String(err.message);
    throw new Error(`yt-dlp gagal: ${line.replace(/^.*ERROR:\s*/i, '').slice(0, 220)}`);
  }
}

function availableFormats() {
  return ['ogg', 'mp3', 'wav', 'flac', 'm4a'];
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = {
  FFMPEG,
  FFPROBE,
  YTDLP,
  probe,
  deriveAmplify,
  convert,
  split,
  extract,
  metadata,
  availableFormats,
  formatDuration,
};
