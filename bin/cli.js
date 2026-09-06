#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { renderToFile, loadConfig, ConfigError } = require('../src');
const pkg = require('../package.json');

const USAGE = `
competency-radar - render a configurable skills / competency radar chart

Usage:
  competency-radar [render] -c <config.json> [-o <out.svg>] [options]
  competency-radar init [file.json]
  competency-radar --help | --version

Options:
  -c, --config <file>      Config file (.json or .js). Required for "render".
  -o, --out <file>         Output file. Default: out/<config name>.svg
  -f, --format <fmt>       svg | png | html. Default: from the output extension.
      --orientation <o>    landscape | portrait (overrides the config)
      --width <px>         Canvas width (overrides the config)
      --height <px>        Canvas height (overrides the config)
      --title <text>       Chart title (overrides the config)
      --profiles <a,b>     Render only these profiles (by name or id)
      --scale <n>          PNG only: pixel scale factor. Default: 1
      --png-width <px>     PNG only: output width in pixels (overrides --scale)
      --quiet              Do not print the summary line

Examples:
  competency-radar -c examples/test-roles.json -o out/roles.svg
  competency-radar -c examples/test-roles.json -o out/roles.png --png-width 2400
  competency-radar -c examples/test-roles.json -o out/roles.svg --orientation portrait
  competency-radar -c examples/test-roles.json -o out/manager.svg --profiles "Test Manager"
`;

const STARTER = {
  title: 'Skills radar',
  orientation: 'landscape',
  levels: [
    { name: 'Basic', description: 'knows about' },
    { name: 'Advanced', description: 'can apply' },
    { name: 'Expert', description: 'drives, coaches and is able to improve in own domain & scope' }
  ],
  categories: [
    { name: 'Craft', color: '#5f9e93' },
    { name: 'Product', color: '#c9a86a' },
    { name: 'People', color: '#b23a3a' }
  ],
  skills: {
    Craft: ['Coding', 'Testing', 'Architecture', 'Operations'],
    Product: ['Domain knowledge', 'Requirements', 'UX'],
    People: ['Communication', 'Mentoring', 'Leadership']
  },
  profiles: [
    {
      name: 'Current',
      color: '#1f9c2e',
      values: {
        Coding: 3, Testing: 2, Architecture: 2, Operations: 1.5,
        'Domain knowledge': 2, Requirements: 2, UX: 1,
        Communication: 2.5, Mentoring: 2, Leadership: 1.5
      }
    },
    {
      name: 'Target',
      color: '#e8231a',
      values: {
        Coding: 3, Testing: 3, Architecture: 3, Operations: 2,
        'Domain knowledge': 2.5, Requirements: 2.5, UX: 1.5,
        Communication: 3, Mentoring: 3, Leadership: 2.5
      }
    }
  ]
};

function parseArgs(argv) {
  const opts = { _: [] };
  const alias = { c: 'config', o: 'out', f: 'format', h: 'help', v: 'version' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { opts._.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith('-')) {
      const raw = arg.replace(/^--?/, '');
      const [name, inlineValue] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
      const key = alias[name] || name;
      if (key === 'help' || key === 'version' || key === 'quiet') { opts[key] = true; continue; }
      const value = inlineValue !== undefined ? inlineValue : argv[++i];
      if (value === undefined) throw new Error(`Missing value for --${key}`);
      opts[key] = value;
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

function num(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`--${name} expects a number, got "${value}"`);
  return n;
}

function runInit(opts) {
  const target = opts._[1] || opts.out || 'competency-radar.config.json';
  if (fs.existsSync(target)) throw new Error(`${target} already exists - delete it or pick another name`);
  fs.writeFileSync(target, JSON.stringify(STARTER, null, 2) + '\n', 'utf8');
  if (!opts.quiet) console.log(`Wrote starter config to ${target}`);
}

function runRender(opts) {
  if (!opts.config) throw new Error('Missing --config <file>. Run "skills-radar --help" for usage.');
  const raw = loadConfig(opts.config);
  const cfg = Object.assign({}, raw);

  if (opts.orientation) cfg.orientation = opts.orientation;
  if (opts.title) cfg.title = opts.title;
  if (opts.width) cfg.width = num(opts.width, 'width');
  if (opts.height) cfg.height = num(opts.height, 'height');

  // A width/height carried over from the file would fight an orientation flip.
  if (opts.orientation && !opts.width && raw.width) delete cfg.width;
  if (opts.orientation && !opts.height && raw.height) delete cfg.height;

  if (opts.profiles) {
    const wanted = opts.profiles.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const all = Array.isArray(raw.profiles) ? raw.profiles : [];
    cfg.profiles = all.filter((p) => wanted.includes(String(p.name || '').toLowerCase()) ||
      wanted.includes(String(p.id || '').toLowerCase()));
    const missing = wanted.filter((w) => !cfg.profiles.some((p) =>
      String(p.name || '').toLowerCase() === w || String(p.id || '').toLowerCase() === w));
    if (missing.length) {
      throw new Error(`Unknown profile(s): ${missing.join(', ')}. Available: ${all.map((p) => p.name).join(', ')}`);
    }
  }

  const defaultName = path.basename(opts.config).replace(/\.(json|js)$/i, '');
  const out = opts.out || path.join('out', `${defaultName}.svg`);
  const result = renderToFile(cfg, out, {
    format: opts.format,
    scale: opts.scale ? num(opts.scale, 'scale') : undefined,
    width: opts['png-width'] ? num(opts['png-width'], 'png-width') : undefined
  });

  if (!opts.quiet) {
    const c = result.config;
    console.log(
      `${result.file}  [${result.format}] ` +
      `${c.width}x${c.height} ${c.orientation}, ` +
      `${c.skills.length} skills / ${c.categories.length} categories / ` +
      `${c.levels.length} levels / ${c.profiles.length} profile(s)`
    );
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  if (opts.version) { console.log(pkg.version); return; }
  if (opts.help || (!opts.config && !opts._.length)) { console.log(USAGE.trim()); return; }

  const command = opts._[0] === 'init' || opts._[0] === 'render' ? opts._[0] : 'render';

  try {
    if (command === 'init') runInit(opts);
    else runRender(opts);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (!(err instanceof ConfigError) && process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();
