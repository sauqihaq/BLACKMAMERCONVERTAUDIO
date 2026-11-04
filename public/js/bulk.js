/* BLACKMAMERSTUDIO — queued bulk conversion and dependency-free ZIP downloads. */
(function () {
  'use strict';

  var MAX_FILES = 50;
  var MAX_ZIP_BYTES = 180 * 1024 * 1024;
  var EXTENSIONS = /\.(mp3|wav|flac|m4a|ogg|aac|opus|wma|aiff|aif|mp4|webm)$/i;
  var batch = { items: [], running: false, stop: false };
  var context = null;

  function el(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatBytes(value) {
    var units = ['B', 'KB', 'MB', 'GB'];
    var n = Number(value) || 0;
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i && n < 10 ? 1 : 0) + ' ' + units[i];
  }
  function partsOfFinishedJobs() {
    return batch.items.filter(function (item) { return item.status === 'done'; })
      .reduce(function (all, item) { return all.concat(item.parts || []); }, []);
  }

  function mount() {
    var page = document.querySelector('#content .page');
    if (!page) return;
    if (!el('bulk-card')) {
      page.insertAdjacentHTML('beforeend',
        '<section class="card bms-bulk-card" id="bulk-card" hidden aria-live="polite">' +
          '<div class="card-head"><span class="eyebrow">Batch processing</span>' +
            '<h3>Bulk Audio Converter</h3><span class="badge row-end" id="bulk-summary">0 files</span></div>' +
          '<div class="card-body">' +
            '<div class="bms-bulk-top"><div><strong id="bulk-count">0 / 0 complete</strong>' +
              '<p class="hint" id="bulk-message">Selected files will convert in order.</p></div>' +
              '<button class="btn btn-outline btn-sm" type="button" id="bulk-stop-btn" hidden>Stop after current file</button></div>' +
            '<div class="progress-track bms-bulk-track"><div class="progress-fill" id="bulk-progress" style="width:0%"></div></div>' +
            '<div id="bulk-items" class="bms-bulk-items"></div>' +
            '<div class="bms-bulk-actions"><button class="btn" type="button" id="bulk-zip-btn" hidden>Download all as ZIP</button>' +
              '<span class="hint" id="bulk-zip-note">Each completed file can also be downloaded separately.</span></div>' +
          '</div></section>'
      );
      el('bulk-stop-btn').addEventListener('click', function () {
        batch.stop = true;
        el('bulk-stop-btn').disabled = true;
        render();
      });
      el('bulk-zip-btn').addEventListener('click', downloadZip);
    }
    render();
  }

  function render() {
    var card = el('bulk-card');
    if (!card) return;
    card.hidden = batch.items.length === 0;
    if (!batch.items.length) return;

    var done = batch.items.filter(function (item) { return item.status === 'done'; }).length;
    var failed = batch.items.filter(function (item) { return item.status === 'error'; }).length;
    var skipped = batch.items.filter(function (item) { return item.status === 'skipped'; }).length;
    var completed = done + failed + skipped;
    var progress = batch.items.reduce(function (sum, item) {
      return sum + (['done', 'error', 'skipped'].includes(item.status) ? 100 : (item.percent || 0));
    }, 0) / batch.items.length;

    el('bulk-summary').textContent = done + ' successful · ' + failed + ' failed';
    el('bulk-count').textContent = completed + ' / ' + batch.items.length + ' processed';
    el('bulk-message').textContent = batch.running
      ? (batch.stop ? 'Stopping after the current conversion…' : 'Converting one file at a time to keep the server responsive.')
      : 'Batch finished. Successful conversions are ready below.';
    el('bulk-progress').style.width = Math.max(0, Math.min(100, progress)) + '%';

    el('bulk-items').innerHTML = batch.items.map(function (item, index) {
      var label = { queued: 'Queued', uploading: 'Uploading', reading: 'Reading', probing: 'Analysing',
        converting: 'Converting', splitting: 'Splitting', storing: 'Saving',
        downloading: 'Downloading', metadata: 'Metadata', done: 'Done',
        error: 'Failed', skipped: 'Skipped' }[item.status] || item.status;
      var links = (item.parts || []).map(function (part) {
        return '<a class="btn btn-outline btn-sm" href="' + escapeHtml(part.url) +
          '" download="' + escapeHtml(part.fileName) + '">Download ' +
          (item.parts.length > 1 ? 'part ' + part.index : 'audio') + '</a>';
      }).join('');
      return '<div class="bms-bulk-item"><div class="bms-bulk-item-head">' +
        '<span class="bms-bulk-index">' + (index + 1) + '</span>' +
        '<div class="bms-bulk-item-name"><strong title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) +
          '</strong><small>' + formatBytes(item.size) + (item.message ? ' · ' + escapeHtml(item.message) : '') + '</small></div>' +
        '<span class="bms-bulk-status is-' + escapeHtml(item.status) + '">' + escapeHtml(label) + '</span></div>' +
        '<div class="bms-bulk-mini"><i style="width:' + Math.max(0, Math.min(100, item.percent || 0)) + '%"></i></div>' +
        (item.error ? '<p class="bms-bulk-error">' + escapeHtml(item.error) + '</p>' : '') +
        (links ? '<div class="bms-bulk-links">' + links + '</div>' : '') + '</div>';
    }).join('');

    var zip = el('bulk-zip-btn');
    zip.hidden = done === 0 || batch.running;
    el('bulk-stop-btn').hidden = !batch.running;
    el('bulk-stop-btn').disabled = batch.stop;
    el('bulk-zip-note').textContent = done
      ? done + ' converted · ' + partsOfFinishedJobs().length + ' audio output files ready'
      : 'Each converted file will have its own download link.';
    var convert = el('convert-btn');
    if (convert && batch.running) convert.disabled = true;
  }

  function waitForJob(jobId, onUpdate) {
    return new Promise(function (resolve, reject) {
      var closed = false;
      var source = null;
      var pollStarted = false;
      var failures = 0;
      var started = Date.now();
      function finish(error, job) {
        if (closed) return;
        closed = true;
        if (source) source.close();
        if (error) reject(error); else resolve(job);
      }
      function handle(job) {
        if (closed) return;
        onUpdate(job);
        if (job.stage === 'done') finish(null, job);
        if (job.stage === 'error') finish(new Error(job.error || 'Conversion failed.'));
      }
      async function poll() {
        if (pollStarted) return;
        pollStarted = true;
        while (!closed && Date.now() - started < 20 * 60 * 1000) {
          try {
            var job = await context.api('/api/jobs/' + encodeURIComponent(jobId));
            failures = 0;
            handle(job);
          } catch (error) {
            failures++;
            if (failures >= 5) return finish(error);
          }
          if (!closed) await new Promise(function (r) { setTimeout(r, 1500); });
        }
        if (!closed) finish(new Error('Job timed out. Please check the server.'));
      }
      try {
        source = new EventSource('/api/jobs/' + encodeURIComponent(jobId) + '/stream');
        source.onmessage = function (event) {
          try { handle(JSON.parse(event.data)); } catch (error) { /* ignore malformed event */ }
        };
        source.onerror = function () {
          source.close();
          poll();
        };
      } catch (error) { poll(); }
    });
  }

  async function start(files, settings) {
    if (batch.running) {
      settings.toast('A bulk conversion is already running.', 'error');
      return;
    }
    if (!files.length) throw new Error('Choose audio files first.');
    if (files.length > MAX_FILES) throw new Error('Choose at most ' + MAX_FILES + ' audio files per batch.');
    var invalid = files.find(function (file) { return !EXTENSIONS.test(file.name); });
    if (invalid) throw new Error('Unsupported file format: ' + invalid.name);
    var maxMb = Number(settings.me.plan.maxFileMb) || 200;
    var tooBig = files.find(function (file) { return file.size > maxMb * 1024 * 1024; });
    if (tooBig) throw new Error(tooBig.name + ' is larger than ' + maxMb + ' MB.');
    var left = settings.me.quota.left;
    if (left !== null && files.length > left) {
      throw new Error('You have ' + left + ' conversions left today, but selected ' + files.length + ' files.');
    }
    context = settings;
    batch.items = files.map(function (file) {
      return { file: file, name: file.name, size: file.size, status: 'queued',
        percent: 0, message: '', parts: [], error: '' };
    });
    batch.running = true;
    batch.stop = false;
    mount();
    try {
      for (var i = 0; i < batch.items.length; i++) {
        var item = batch.items[i];
        if (batch.stop) {
          item.status = 'skipped';
          item.percent = 100;
          render();
          continue;
        }
        item.status = 'uploading';
        item.percent = 1;
        item.message = 'Uploading to converter';
        render();
        try {
          var form = new FormData();
          form.append('file', item.file);
          form.append('preset', settings.preset);
          if (settings.normalize) form.append('normalize', 'true');
          var response = await settings.api('/api/convert-upload', { method: 'POST', body: form });
          var result = await waitForJob(response.jobId, function (job) {
            item.status = job.stage;
            item.percent = Number(job.percent) || 0;
            item.message = job.message || '';
            render();
          });
          item.status = 'done';
          item.percent = 100;
          item.message = (result.parts || []).length + ' audio output(s)';
          item.parts = result.parts || [];
          if (settings.me.quota.left !== null) {
            settings.me.quota.left = Math.max(0, settings.me.quota.left - 1);
            settings.paintUser();
            if (el('bms-stat-quota')) el('bms-stat-quota').textContent = String(settings.me.quota.left);
          }
        } catch (error) {
          item.status = 'error';
          item.percent = 100;
          item.error = error.message || 'Conversion failed.';
          if (error.status === 402) {
            batch.stop = true;
            settings.toast('Daily conversion quota has been reached.', 'error');
          }
        }
        item.file = null; // release the original upload from memory when possible
        render();
      }
    } finally {
      batch.running = false;
      var button = el('convert-btn');
      if (button) button.disabled = false;
      render();
      var successful = batch.items.filter(function (item) { return item.status === 'done'; }).length;
      settings.toast(successful + '/' + batch.items.length + ' audio files converted.',
        successful === batch.items.length ? 'success' : 'error');
    }
  }

  // ZIP STORE method: OGG audio is already compressed, so re-compression adds CPU
  // cost without saving space. Generates a standards-compatible ZIP with no CDN.
  var crcTable = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var value = n;
      for (var k = 0; k < 8; k++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
      table[n] = value >>> 0;
    }
    return table;
  }());
  function crc32(data) {
    var value = 0xffffffff;
    for (var i = 0; i < data.length; i++) value = crcTable[(value ^ data[i]) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }
  function u16(view, at, value) { view.setUint16(at, value, true); }
  function u32(view, at, value) { view.setUint32(at, value >>> 0, true); }
  function zipStored(entries) {
    var encoder = new TextEncoder();
    var out = [];
    var directory = [];
    var offset = 0;
    var now = new Date();
    var time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    var date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    entries.forEach(function (entry) {
      var name = encoder.encode(entry.name.replace(/[\\/]/g, '_'));
      var checksum = crc32(entry.data);
      var local = new Uint8Array(30 + name.length);
      var v = new DataView(local.buffer);
      u32(v, 0, 0x04034b50); u16(v, 4, 20); u16(v, 6, 0x0800);
      u16(v, 10, time); u16(v, 12, date); u32(v, 14, checksum);
      u32(v, 18, entry.data.length); u32(v, 22, entry.data.length);
      u16(v, 26, name.length); local.set(name, 30);
      out.push(local, entry.data);

      var center = new Uint8Array(46 + name.length);
      var c = new DataView(center.buffer);
      u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20); u16(c, 8, 0x0800);
      u16(c, 12, time); u16(c, 14, date); u32(c, 16, checksum);
      u32(c, 20, entry.data.length); u32(c, 24, entry.data.length);
      u16(c, 28, name.length); u32(c, 42, offset);
      center.set(name, 46);
      directory.push(center);
      offset += local.length + entry.data.length;
    });
    var directorySize = directory.reduce(function (n, entry) { return n + entry.length; }, 0);
    var end = new Uint8Array(22);
    var d = new DataView(end.buffer);
    u32(d, 0, 0x06054b50); u16(d, 8, entries.length); u16(d, 10, entries.length);
    u32(d, 12, directorySize); u32(d, 16, offset);
    return new Blob(out.concat(directory, [end]), { type: 'application/zip' });
  }

  async function downloadZip() {
    if (batch.running) return;
    var parts = partsOfFinishedJobs();
    if (!parts.length) return;
    var bytes = parts.reduce(function (n, part) { return n + (Number(part.bytes) || 0); }, 0);
    if (bytes > MAX_ZIP_BYTES) {
      context.toast('ZIP is limited to 180 MB in the browser. Use the individual download links for larger batches.', 'error');
      return;
    }
    var button = el('bulk-zip-btn');
    if (button) { button.disabled = true; button.textContent = 'Preparing ZIP…'; }
    try {
      var entries = [];
      var total = 0;
      for (var i = 0; i < parts.length; i++) {
        if (button) button.textContent = 'Downloading ' + (i + 1) + '/' + parts.length;
        var res = await fetch(parts[i].url, { credentials: 'include' });
        if (!res.ok) throw new Error('Could not download ' + parts[i].fileName + ' (' + res.status + ').');
        var data = new Uint8Array(await res.arrayBuffer());
        total += data.length;
        if (total > MAX_ZIP_BYTES) throw new Error('ZIP exceeds 180 MB. Please use individual download links.');
        entries.push({ name: parts[i].fileName, data: data });
      }
      if (button) button.textContent = 'Creating ZIP…';
      var blob = zipStored(entries);
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'BLACKMAMERSTUDIO-bulk-' + Date.now() + '.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      context.toast('Bulk ZIP is ready.', 'success');
    } catch (error) {
      context.toast(error.message || 'Could not create ZIP.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Download all as ZIP'; }
    }
  }

  window.BMSBulk = { start: start, mount: mount };
}());
