#!/usr/bin/env node
'use strict';

/** Tiny dependency-free test runner: node test/run.js */

const assert = require('assert');
const path = require('path');
const { renderChart, normalize, loadConfig, toHtml, ConfigError } = require('../src');
const { computeGeometry, computeBands } = require('../src/render');
const { wrapText, measureText } = require('../src/text');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

const minimal = () => ({
  categories: ['Alpha', 'Beta'],
  skills: { Alpha: ['a1', 'a2', 'a3'], Beta: ['b1', 'b2', 'b3'] },
  profiles: [{ name: 'Me', values: { a1: 3, a2: 'Advanced', b1: 1 } }]
});

/* ---------------------------------------------------------------- config */

test('defaults are applied', () => {
  const cfg = normalize(minimal());
  assert.strictEqual(cfg.orientation, 'landscape');
  assert.strictEqual(cfg.levels.length, 3);
  assert.strictEqual(cfg.width, 1800);
  assert.strictEqual(cfg.height, 1000);
});

test('portrait orientation picks the portrait canvas', () => {
  const cfg = normalize({ ...minimal(), orientation: 'portrait' });
  assert.ok(cfg.height > cfg.width, 'portrait canvas should be taller than wide');
});

test('explicit width/height win over the orientation preset', () => {
  const cfg = normalize({ ...minimal(), width: 900, height: 640 });
  assert.strictEqual(cfg.width, 900);
  assert.strictEqual(cfg.height, 640);
});

test('levels accept a count, names, or objects', () => {
  const five = normalize({ ...minimal(), levels: 5, profiles: [{ name: 'Me', values: { a1: 4 } }] });
  assert.strictEqual(five.levels.length, 5);
  const named = normalize({ ...minimal(), levels: ['Low', 'High'], profiles: [{ name: 'Me', values: { a1: 2 } }] });
  assert.deepStrictEqual(named.levels.map((l) => l.name), ['Low', 'High']);
});

test('level names are accepted as competency values', () => {
  const cfg = normalize(minimal());
  const me = cfg.profiles[0];
  const idx = cfg.skills.findIndex((s) => s.id === 'a2');
  assert.strictEqual(me.values[idx], 2, '"Advanced" should map to level 2');
});

test('skills given as a flat array are regrouped into category order', () => {
  const cfg = normalize({
    categories: ['Alpha', 'Beta'],
    skills: [
      { name: 'b1', category: 'Beta' },
      { name: 'a1', category: 'Alpha' },
      { name: 'b2', category: 'Beta' },
      { name: 'a2', category: 'Alpha' }
    ],
    profiles: [{ name: 'Me', values: { a1: 1 } }]
  });
  assert.deepStrictEqual(cfg.skills.map((s) => s.id), ['a1', 'a2', 'b1', 'b2']);
});

test('categories fall back to the palette', () => {
  const cfg = normalize(minimal());
  assert.match(cfg.categories[0].color, /^#/);
  assert.notStrictEqual(cfg.categories[0].color, cfg.categories[1].color);
});

test('custom colour scheme overrides only the given keys', () => {
  const cfg = normalize({ ...minimal(), colorScheme: { background: '#000000' } });
  assert.strictEqual(cfg.colorScheme.background, '#000000');
  assert.strictEqual(cfg.colorScheme.profileFillOpacity, 0.16, 'other keys keep their defaults');
});

test('unknown category is reported', () => {
  assert.throws(
    () => normalize({ categories: ['Alpha'], skills: [{ name: 'x', category: 'Nope' }], profiles: [{ name: 'p' }] }),
    (err) => err instanceof ConfigError && /unknown category "Nope"/.test(err.message)
  );
});

test('unknown skill in a profile is reported', () => {
  assert.throws(
    () => normalize({ ...minimal(), profiles: [{ name: 'Me', values: { nope: 2 } }] }),
    (err) => err instanceof ConfigError && /unknown skill "nope"/.test(err.message)
  );
});

test('out-of-range and non-level values are reported', () => {
  assert.throws(() => normalize({ ...minimal(), profiles: [{ name: 'Me', values: { a1: 9 } }] }), ConfigError);
  assert.throws(() => normalize({ ...minimal(), profiles: [{ name: 'Me', values: { a1: 'Wizard' } }] }), ConfigError);
});

test('bad orientation is reported', () => {
  assert.throws(() => normalize({ ...minimal(), orientation: 'diagonal' }), ConfigError);
});

test('all errors are collected, not just the first', () => {
  try {
    normalize({ categories: ['Alpha'], skills: { Alpha: ['a1', 'a2', 'a3'] }, profiles: [{ name: 'p', values: { x: 1, y: 2 } }] });
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.errors.length, 2);
  }
});

/* -------------------------------------------------------------- geometry */

test('skills are spread evenly around the circle', () => {
  const cfg = normalize(minimal());
  const geo = computeGeometry(cfg);
  const angles = geo.skills.map((s) => s.angle);
  const step = 360 / cfg.skills.length;
  for (let i = 1; i < angles.length; i++) {
    assert.ok(Math.abs((angles[i] - angles[i - 1]) - step) < 1e-9);
  }
});

test('level radii are evenly spaced and end at the outer ring', () => {
  const geo = computeGeometry(normalize(minimal()));
  assert.ok(Math.abs(geo.levelRadius(3) - geo.r) < 1e-9);
  assert.ok(Math.abs(geo.levelRadius(1.5) - geo.r / 2) < 1e-9);
});

test('the chart stays inside the canvas', () => {
  for (const orientation of ['landscape', 'portrait']) {
    const geo = computeGeometry(normalize({ ...minimal(), orientation }));
    assert.ok(geo.cx - geo.r >= 0 && geo.cx + geo.r <= geo.W, `${orientation}: horizontal overflow`);
    assert.ok(geo.cy - geo.r >= 0 && geo.cy + geo.r <= geo.H, `${orientation}: vertical overflow`);
  }
});

test('category bands tile the full canvas height on each side', () => {
  const cfg = normalize(loadConfig(path.join(__dirname, '..', 'examples', 'test-roles.json')));
  const geo = computeGeometry(cfg);
  const bands = computeBands(cfg, geo);
  assert.strictEqual(bands.length, cfg.categories.length);
  for (const side of ['left', 'right']) {
    const own = bands.filter((b) => b.side === side).sort((a, b) => a.y0 - b.y0);
    assert.ok(own.length > 0, `${side} side has no bands`);
    assert.strictEqual(own[0].y0, 0);
    assert.strictEqual(own[own.length - 1].y1, geo.H);
    for (let i = 1; i < own.length; i++) {
      assert.ok(Math.abs(own[i].y0 - own[i - 1].y1) < 1e-9, 'bands must not gap or overlap');
    }
  }
});

test('a category straddling the vertical axis still gets a band', () => {
  // "Testing and quality" wraps past the bottom of the circle.
  const cfg = normalize(loadConfig(path.join(__dirname, '..', 'examples', 'test-roles.json')));
  const bands = computeBands(cfg, computeGeometry(cfg));
  const band = bands.find((b) => b.category.name === 'Testing and quality');
  assert.strictEqual(band.side, 'left');
  assert.ok(band.y1 - band.y0 > 100, 'band should have a usable height');
});

/* ------------------------------------------------------------------ text */

test('wrapText respects the width and keeps every word', () => {
  const lines = wrapText('one two three four five six', 60, 20, false);
  assert.ok(lines.length > 1);
  assert.strictEqual(lines.join(' ').split(' ').length, 6);
});

test('measureText grows with length and font size', () => {
  assert.ok(measureText('abcd', 20) > measureText('ab', 20));
  assert.ok(measureText('abcd', 40) > measureText('abcd', 20));
});

/* ---------------------------------------------------------------- render */

test('renders valid, self-contained SVG', () => {
  const svg = renderChart(minimal());
  assert.ok(svg.startsWith('<svg '), 'starts with an <svg> element');
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(!/<image|xlink:href|<script/.test(svg), 'no external references');
  const opens = (svg.match(/<g[ >]/g) || []).length;
  const closes = (svg.match(/<\/g>/g) || []).length;
  assert.strictEqual(opens, closes, 'balanced <g> elements');
});

test('every skill, category, level and profile name appears in the output', () => {
  const cfg = loadConfig(path.join(__dirname, '..', 'examples', 'test-roles.json'));
  const svg = renderChart(cfg);
  const normalized = normalize(cfg);
  for (const s of normalized.skills) assert.ok(svg.includes(s.name.split(' ')[0]), `missing skill ${s.name}`);
  for (const c of normalized.categories) assert.ok(svg.includes(c.name.split(' ')[0]), `missing category ${c.name}`);
  for (const l of normalized.levels) assert.ok(svg.includes(l.name), `missing level ${l.name}`);
  for (const p of normalized.profiles) {
    assert.ok(svg.includes(p.name), `missing profile ${p.name}`);
    assert.ok(svg.includes(p.color), `missing profile colour ${p.color}`);
  }
});

test('one polygon vertex per skill, per profile', () => {
  const cfg = normalize(loadConfig(path.join(__dirname, '..', 'examples', 'test-roles.json')));
  const svg = renderChart(loadConfig(path.join(__dirname, '..', 'examples', 'test-roles.json')));
  const polygons = svg.match(/<polygon points="([^"]+)"/g) || [];
  assert.strictEqual(polygons.length, cfg.profiles.length);
  for (const poly of polygons) {
    const points = poly.match(/points="([^"]+)"/)[1].trim().split(/\s+/);
    assert.strictEqual(points.length, cfg.skills.length);
  }
});

test('special characters are escaped', () => {
  const svg = renderChart({
    categories: ['A & B'],
    skills: { 'A & B': ['<one>', 'two "2"', 'three'] },
    profiles: [{ name: 'R&D', values: { three: 1 } }]
  });
  assert.ok(svg.includes('&amp;'));
  assert.ok(svg.includes('&lt;one&gt;'));
  assert.ok(!/<text[^>]*>[^<]*<one>/.test(svg));
});

test('layout toggles remove their elements', () => {
  const off = renderChart({
    ...minimal(),
    layout: { showBands: false, showWedges: false, showSpokes: false, showProfileLegend: false, showLevelLabels: false }
  });
  assert.ok(!off.includes('category-bands'));
  assert.ok(!off.includes('profile-legend'));
  assert.ok(!off.includes('level-labels'));
  assert.ok(!off.includes('radialGradient'));
});

test('skill labels do not overlap each other', () => {
  const cfg = loadConfig(path.join(__dirname, '..', 'examples', 'test-roles.json'));
  for (const orientation of ['landscape', 'portrait']) {
    const normalized = normalize({ ...cfg, orientation });
    const geo = computeGeometry(normalized);
    const { layoutSkillLabels } = require('../src/render');
    const boxes = layoutSkillLabels(normalized, geo).map((b) => b.box);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const hit = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
        assert.ok(!hit, `${orientation}: skill labels ${i} and ${j} overlap`);
      }
    }
  }
});

test('every skill label sits inside its own category band', () => {
  const raw = loadConfig(path.join(__dirname, '..', 'examples', 'test-roles.json'));
  for (const orientation of ['landscape', 'portrait']) {
    const cfg = normalize({ ...raw, orientation });
    const geo = computeGeometry(cfg);
    const { layoutSkillLabels } = require('../src/render');
    const labels = layoutSkillLabels(cfg, geo);
    const bands = computeBands(cfg, geo, labels);

    for (const label of labels) {
      const band = bands.find((b) => b.category.id === label.category);
      assert.strictEqual(label.side, band.side, `${orientation}: ${label.skill} is on the wrong side of the canvas`);
      const mid = (label.box.y0 + label.box.y1) / 2;
      assert.ok(
        mid >= band.y0 && mid <= band.y1,
        `${orientation}: "${label.skill}" at y=${Math.round(mid)} is outside the ` +
        `"${band.category.name}" band (${Math.round(band.y0)}..${Math.round(band.y1)})`
      );
    }
  }
});

test('html wrapper embeds the svg', () => {
  const html = toHtml(renderChart(minimal()), 'Title');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<svg '));
  assert.ok(html.includes('<title>Title</title>'));
});

test('both bundled examples render', () => {
  for (const file of ['test-roles.json', 'engineering-competencies.json']) {
    const raw = loadConfig(path.join(__dirname, '..', 'examples', file));
    for (const orientation of ['landscape', 'portrait']) {
      const cfg = { ...raw, orientation };
      delete cfg.width;
      delete cfg.height;
      assert.ok(renderChart(cfg).length > 1000, `${file} (${orientation})`);
    }
  }
});

/* ---------------------------------------------------------------- report */

for (const f of failures) {
  console.error(`FAIL  ${f.name}\n      ${f.err.message.split('\n').join('\n      ')}`);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
