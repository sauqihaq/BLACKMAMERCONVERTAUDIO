'use strict';

// Standalone yt-dlp downloader for Linux x64 (Vercel build).
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFileSync } = require('node:child_process');

(async () => {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    console.log('[yt-dlp] Installer skipped on this platform.');
    return;
  }

  const folder = path.join(__dirname, '..', 'bin');
  const binary = path.join(folder, 'yt-dlp');
  const temp = binary + '.download';
  fs.mkdirSync(folder, { recursive: true });

  if (fs.existsSync(binary)) {
    fs.chmodSync(binary, 0o755);
    console.log('[yt-dlp] Binary already exists.');
    return;
  }

  try {
    console.log('[yt-dlp] Fetching standalone Linux binary...');
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok || !response.body) {
      throw new Error('Download failed: HTTP ' + response.status);
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
    if (fs.statSync(temp).size < 1024 * 1024) {
      throw new Error('Downloaded executable is unexpectedly small.');
    }
    fs.renameSync(temp, binary);
    fs.chmodSync(binary, 0o755);
    const version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
    console.log('[yt-dlp] Ready: ' + version);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    console.error('[yt-dlp] Installation failed: ' + error.message);
    process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
