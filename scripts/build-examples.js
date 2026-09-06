#!/usr/bin/env node
'use strict';

/** Renders every config in examples/ to out/, in both orientations. */

const fs = require('fs');
const path = require('path');
const { renderToFile, loadConfig } = require('../src');

const examplesDir = path.join(__dirname, '..', 'examples');
const outDir = path.join(__dirname, '..', 'out');

const wantPng = !process.argv.includes('--no-png');
let pngAvailable = wantPng;
if (wantPng) {
  try { require('@resvg/resvg-js'); } catch { pngAvailable = false; }
}

const files = fs.readdirSync(examplesDir).filter((f) => /\.(json|js)$/i.test(f));
if (!files.length) {
  console.error('No example configs found in examples/');
  process.exit(1);
}

for (const file of files) {
  const name = file.replace(/\.(json|js)$/i, '');
  const raw = loadConfig(path.join(examplesDir, file));

  for (const orientation of ['landscape', 'portrait']) {
    const cfg = { ...raw, orientation };
    delete cfg.width;
    delete cfg.height;
    const base = path.join(outDir, `${name}-${orientation}`);
    const svg = renderToFile(cfg, `${base}.svg`);
    renderToFile(cfg, `${base}.html`);
    if (pngAvailable) renderToFile(cfg, `${base}.png`, { width: 2000 });
    console.log(`${path.relative(process.cwd(), base)}.svg  (${svg.config.skills.length} skills)`);
  }
}

if (!pngAvailable && wantPng) {
  console.log('\nPNG output skipped - install the optional dependency: npm install @resvg/resvg-js');
}
