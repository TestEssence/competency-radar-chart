'use strict';

const fs = require('fs');
const path = require('path');
const { normalize, loadConfig, ConfigError } = require('./config');
const { renderSvg } = require('./render');
const { esc } = require('./text');
const defaults = require('./defaults');

/** Validate + normalise a raw config and render it to an SVG string. */
function renderChart(rawConfig) {
  return renderSvg(normalize(rawConfig));
}

/** Wrap an SVG string in a minimal standalone HTML page. */
function toHtml(svg, title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'Skills radar chart')}</title>
<style>
  html, body { margin: 0; background: #e9e6e0; }
  main { display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
  svg { max-width: 100%; height: auto; box-shadow: 0 2px 24px rgba(0,0,0,.18); }
</style>
</head>
<body>
<main>
${svg}
</main>
</body>
</html>
`;
}

/**
 * Rasterise an SVG string. Requires the optional dependency @resvg/resvg-js.
 * @param {string} svg
 * @param {{scale?: number, width?: number}} [options]
 * @returns {Buffer} PNG bytes
 */
function toPng(svg, options) {
  const opts = options || {};
  let Resvg;
  try {
    ({ Resvg } = require('@resvg/resvg-js'));
  } catch (err) {
    throw new Error(
      'PNG output needs the optional dependency "@resvg/resvg-js".\n' +
      'Install it with:  npm install @resvg/resvg-js'
    );
  }
  const fit = opts.width
    ? { mode: 'width', value: Math.round(opts.width) }
    : { mode: 'zoom', value: opts.scale || 1 };
  const resvg = new Resvg(svg, {
    fitTo: fit,
    font: { loadSystemFonts: true }
  });
  return resvg.render().asPng();
}

/**
 * Render a config to a file. Format is taken from `options.format`, else from
 * the output file extension.
 */
function renderToFile(rawConfig, outFile, options) {
  const opts = options || {};
  const cfg = normalize(rawConfig);
  const svg = renderSvg(cfg);
  const format = (opts.format || path.extname(outFile).replace('.', '') || 'svg').toLowerCase();

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });

  if (format === 'svg') {
    fs.writeFileSync(outFile, svg, 'utf8');
  } else if (format === 'html' || format === 'htm') {
    fs.writeFileSync(outFile, toHtml(svg, cfg.title), 'utf8');
  } else if (format === 'png') {
    fs.writeFileSync(outFile, toPng(svg, opts));
  } else {
    throw new Error(`Unsupported output format "${format}" (expected svg, png or html)`);
  }
  return { file: path.resolve(outFile), format, svg, config: cfg };
}

module.exports = {
  renderChart,
  renderSvg,
  renderToFile,
  toHtml,
  toPng,
  normalize,
  loadConfig,
  ConfigError,
  defaults
};
