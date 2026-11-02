"use strict";
// BLACKMAMERSTUDIO public HTML is bundled and already built.
// This check intentionally never regenerates pages from unavailable reference files.
const fs = require('fs');
const path = require('path');
const required = ['en/index.html','id/index.html','dashboard.html','checkout.html',
  'en/privacy.html','id/privacy.html','en/terms.html','id/terms.html',
  'assets/core.css','assets/premium.css','assets/logo.webp','assets/blackmamer-hero.webp'];
let missing = 0;
for (const name of required) {
  const file = path.join(__dirname,'..','public',name);
  if (!fs.existsSync(file)) { console.error(`[missing] ${name}`); missing++; }
  else console.log(`[ok] ${name}`);
}
if (missing) process.exitCode=1;
else console.log('BLACKMAMERSTUDIO pages are ready.');
