'use strict';

const { polar, sectorPath, polygonPoints, normAngle, round } = require('./geometry');
const { measureText, wrapText, esc } = require('./text');

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/**
 * The "Basic: knows about" strip along the bottom. Laid out before the chart
 * geometry, because how far its descriptions wrap decides how much height the
 * footer takes away from the circle.
 */
function layoutLevelLegend(cfg) {
  const L = cfg.layout;
  if (!L.showLevelLegend) return null;
  const items = cfg.levels.filter((l) => l.description);
  if (!items.length) return null;

  const fs = L.footerFontSize;
  const lh = fs * 1.2;
  const colW = (cfg.width - 2 * L.margin) / items.length;

  const entries = items.map((level, i) => {
    const label = `${level.name}:`;
    const labelW = measureText(label, fs, true) + 10;
    return {
      label,
      labelW,
      x: L.margin + colW * i,
      lines: wrapText(level.description, Math.max(90, colW - labelW - 18), fs, false)
    };
  });

  const maxLines = Math.max(...entries.map((e) => e.lines.length));
  const height = Math.max(L.footerHeight, L.margin * 1.4 + fs + (maxLines - 1) * lh);
  return { entries, height, fs, lh };
}

function computeGeometry(cfg) {
  const L = cfg.layout;
  const W = cfg.width;
  const H = cfg.height;

  const levelLegend = layoutLevelLegend(cfg);
  const hasFooter = Boolean(levelLegend);
  const titleH = cfg.title ? L.titleHeight + (cfg.subtitle ? L.subtitleFontSize + 10 : 0) : 0;
  const footerH = hasFooter ? levelLegend.height : 0;

  // skillLabelSpace is either a fraction of the width (<= 1) or a pixel value.
  const side = L.skillLabelSpace <= 1 ? L.skillLabelSpace * W : L.skillLabelSpace;

  // Headroom above and below the circle for the skill labels that sit on the
  // vertical axis, so they never run off the canvas.
  const headroom = L.skillFontSize * 3.2;
  const chartTop = titleH + L.chartPadding;
  const chartBottom = H - footerH - L.chartPadding;

  const availW = Math.max(80, W - 2 * side);
  const availH = Math.max(80, chartBottom - chartTop - 2 * headroom);
  const r = Math.max(40, (Math.min(availW, availH) / 2) * L.radiusScale);

  const cx = W / 2;
  const cy = (chartTop + chartBottom) / 2;

  const n = cfg.skills.length;
  const step = 360 / n;
  const angleOf = (i) => L.startAngle + (i + L.angleOffset) * step;

  const skills = cfg.skills.map((s) => ({ ...s, angle: angleOf(s.index) }));

  // One contiguous arc per category, with boundaries falling between spokes.
  const arcs = cfg.categories.map((cat) => {
    const own = skills.filter((s) => s.category === cat.id);
    const first = own[0].index;
    const last = own[own.length - 1].index;
    const a0 = L.startAngle + (first + L.angleOffset - 0.5) * step;
    const a1 = L.startAngle + (last + L.angleOffset + 0.5) * step;
    return {
      category: cat,
      a0,
      a1,
      // Which edge of the canvas this category's banner band runs to.
      side: normAngle((a0 + a1) / 2, -90) < 90 ? 'right' : 'left'
    };
  });
  const sideOf = new Map(arcs.map((arc) => [arc.category.id, arc.side]));

  const levelRadius = (value) => (r * value) / cfg.levels.length;

  return { W, H, cx, cy, r, side, step, titleH, footerH, hasFooter, levelLegend, skills, arcs, sideOf, levelRadius };
}

/**
 * Vertical progress (0 = top of canvas, 1 = bottom) of an angle along one side
 * of the chart. Angles that fall on the opposite half are pinned to whichever
 * end of this side they wrapped past, so a category straddling the vertical
 * axis still produces a sane band.
 */
function sideProgress(angle, side) {
  const a = normAngle(angle, -90); // [-90, 270)
  if (side === 'right') {
    if (a <= 90) return (a + 90) / 180;
    return a < 180 ? 1 : 0;
  }
  if (a >= 90) return (270 - a) / 180;
  return a >= 0 ? 1 : 0;
}

/**
 * Category banner bands. Each category runs to the left or right edge of the
 * canvas, and its band is bounded by the skill labels it owns: every boundary
 * falls in the gap between the last label of one category and the first label
 * of the next, so a label always sits on its own category's colour. The bands
 * on a side tile the full canvas height.
 */
function computeBands(cfg, geo, skillLabels) {
  const H = geo.H;
  const labels = skillLabels || layoutSkillLabels(cfg, geo);
  const sides = { left: [], right: [] };

  for (const arc of geo.arcs) {
    // Only the labels that ended up on this band's own side can bound it; a
    // category straddling the vertical axis spills one or two onto the other.
    const own = labels.filter((l) => l.category === arc.category.id && l.side === arc.side);
    const fallback = sideProgress((arc.a0 + arc.a1) / 2, arc.side) * H;
    sides[arc.side].push({
      category: arc.category,
      side: arc.side,
      top: own.length ? Math.min(...own.map((l) => l.box.y0)) : fallback,
      bottom: own.length ? Math.max(...own.map((l) => l.box.y1)) : fallback,
      order: sideProgress(arc.side === 'right' ? arc.a0 : arc.a1, arc.side)
    });
  }

  const bands = [];
  for (const side of ['left', 'right']) {
    const list = sides[side].sort((a, b) => a.order - b.order);
    if (!list.length) continue;
    let y = 0;
    list.forEach((band, i) => {
      band.y0 = y;
      if (i === list.length - 1) {
        y = H;
      } else {
        const gapMid = (band.bottom + list[i + 1].top) / 2;
        y = clamp(gapMid, band.y0 + 1, H - (list.length - 1 - i));
      }
      band.y1 = y;
      bands.push(band);
    });
  }
  return bands;
}

/* ------------------------------------------------------------------ *
 * SVG pieces
 * ------------------------------------------------------------------ */

/**
 * Position a wrapped block of text and record the box it occupies, so other
 * elements can be laid out around it.
 * `align`: 1 = block sits above y, 0 = centred on y, -1 = below y.
 */
function layoutBlock(lines, x, y, opts) {
  const o = { anchor: 'middle', align: 0, lineHeightFactor: 1.16, ...opts };
  const lh = o.fontSize * o.lineHeightFactor;
  const blockH = lines.length * lh;
  const width = lines.reduce((max, line) => Math.max(max, measureText(line, o.fontSize, o.bold)), 0);
  const top = y - blockH / 2 - o.align * (blockH / 2);
  let x0 = x - width / 2;
  if (o.anchor === 'start') x0 = x;
  if (o.anchor === 'end') x0 = x - width;
  return {
    lines,
    x,
    top,
    lineHeight: lh,
    opts: o,
    box: { x0, y0: top, x1: x0 + width, y1: top + blockH }
  };
}

function drawBlock(block) {
  const o = block.opts;
  const attrs = [
    `text-anchor="${o.anchor}"`,
    `font-size="${round(o.fontSize)}"`,
    o.bold ? 'font-weight="700"' : null,
    `fill="${o.color}"`,
    o.opacity != null ? `opacity="${o.opacity}"` : null
  ].filter(Boolean).join(' ');

  return block.lines.map((line, i) => {
    const ly = block.top + i * block.lineHeight + o.fontSize * 0.78;
    return `<text x="${round(block.x)}" y="${round(ly)}" ${attrs}>${esc(line)}</text>`;
  }).join('\n');
}

function textBlock(lines, x, y, opts) {
  return drawBlock(layoutBlock(lines, x, y, opts));
}

function overlaps(a, b, pad = 0) {
  return a.x0 < b.x1 + pad && a.x1 + pad > b.x0 && a.y0 < b.y1 + pad && a.y1 + pad > b.y0;
}

/** Area of the intersection of box `a`, grown by `pad`, with box `b`. */
function overlapArea(a, b, pad = 0) {
  const w = Math.min(a.x1 + pad, b.x1) - Math.max(a.x0 - pad, b.x0);
  const h = Math.min(a.y1 + pad, b.y1) - Math.max(a.y0 - pad, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function renderDefs(cfg, geo, bands) {
  const cs = cfg.colorScheme;
  const defs = [];

  if (cfg.layout.showWedges) {
    cfg.categories.forEach((cat, i) => {
      defs.push(
        `<radialGradient id="wedge-${i}" gradientUnits="userSpaceOnUse" ` +
        `cx="${round(geo.cx)}" cy="${round(geo.cy)}" r="${round(geo.r)}">` +
        `<stop offset="0" stop-color="${cat.color}" stop-opacity="0.03"/>` +
        `<stop offset="0.6" stop-color="${cat.color}" stop-opacity="0.28"/>` +
        `<stop offset="1" stop-color="${cat.color}" stop-opacity="0.85"/>` +
        `</radialGradient>`
      );
    });
  }

  if (cfg.layout.showBands) {
    bands.forEach((band, i) => {
      const inner = geo.cx;
      const outer = band.side === 'right' ? geo.W : 0;
      defs.push(
        `<linearGradient id="band-${i}" gradientUnits="userSpaceOnUse" ` +
        `x1="${round(inner)}" y1="0" x2="${round(outer)}" y2="0">` +
        `<stop offset="0" stop-color="${band.category.color}" stop-opacity="0.12"/>` +
        `<stop offset="0.45" stop-color="${band.category.color}" stop-opacity="0.62"/>` +
        `<stop offset="1" stop-color="${band.category.color}" stop-opacity="1"/>` +
        `</linearGradient>`
      );
    });
  }

  return defs.length ? `<defs>\n${defs.join('\n')}\n</defs>` : '';
}

function renderBands(cfg, geo, bands) {
  if (!cfg.layout.showBands) return '';
  const cs = cfg.colorScheme;
  const rects = bands.map((band, i) => {
    const x = band.side === 'right' ? geo.cx : 0;
    return `<rect x="${round(x)}" y="${round(band.y0)}" width="${round(geo.W / 2)}" ` +
      `height="${round(band.y1 - band.y0)}" fill="url(#band-${i})" opacity="${cs.bandOpacity}"/>`;
  });
  return `<g class="category-bands">\n${rects.join('\n')}\n</g>`;
}

/**
 * Category labels sit in the outer corner at the top of their band, but slide
 * down the band to the first slot that clears the skill labels and the legend.
 */
function layoutBandLabels(cfg, geo, bands, obstacles) {
  if (!cfg.layout.showBands) return [];
  const L = cfg.layout;
  const cs = cfg.colorScheme;
  const maxW = geo.W * 0.24;

  return bands.map((band) => {
    const anchor = band.side === 'right' ? 'end' : 'start';
    const x = band.side === 'right' ? geo.W - L.margin : L.margin;
    const lines = wrapText(band.category.name, maxW, L.categoryFontSize, true);
    const opts = {
      anchor,
      align: -1,
      bold: true,
      fontSize: L.categoryFontSize,
      lineHeightFactor: L.lineHeightFactor,
      color: band.category.labelColor || cs.categoryLabelColor
    };

    const top = band.y0 + L.margin * 0.6;
    const blockH = lines.length * L.categoryFontSize * L.lineHeightFactor;
    const limit = Math.max(top, band.y1 - blockH - L.margin * 0.6);

    // Slide down the band and take the first clear slot; if the band is too
    // crowded for one, take the position that collides least rather than
    // dropping the label straight onto the topmost skill label.
    let best = null;
    let bestScore = Infinity;
    for (let y = top; y <= limit + 0.1; y += 4) {
      const candidate = layoutBlock(lines, x, y, opts);
      const score = obstacles.reduce((sum, box) => sum + overlapArea(candidate.box, box, 3), 0);
      if (score === 0) return candidate;
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best || layoutBlock(lines, x, top, opts);
  });
}

function renderGrid(cfg, geo) {
  const L = cfg.layout;
  const cs = cfg.colorScheme;
  const out = ['<g class="grid">'];

  if (cs.chartBackground && cs.chartBackground !== 'none') {
    out.push(`<circle cx="${round(geo.cx)}" cy="${round(geo.cy)}" r="${round(geo.r)}" fill="${cs.chartBackground}"/>`);
  }

  if (L.showWedges) {
    geo.arcs.forEach((arc, i) => {
      out.push(
        `<path d="${sectorPath(geo.cx, geo.cy, geo.r, arc.a0, arc.a1)}" ` +
        `fill="url(#wedge-${arc.category.index})" opacity="${cs.wedgeOpacity}"/>`
      );
    });
  }

  if (L.showSpokes) {
    for (const skill of geo.skills) {
      const p = polar(geo.cx, geo.cy, geo.r, skill.angle);
      out.push(
        `<line x1="${round(geo.cx)}" y1="${round(geo.cy)}" x2="${round(p.x)}" y2="${round(p.y)}" ` +
        `stroke="${cs.spokeColor}" stroke-width="1.2"/>`
      );
    }
  }

  if (L.showRings) {
    for (let i = 1; i <= cfg.levels.length; i++) {
      const isOuter = i === cfg.levels.length;
      out.push(
        `<circle cx="${round(geo.cx)}" cy="${round(geo.cy)}" r="${round(geo.levelRadius(i))}" ` +
        `fill="none" stroke="${isOuter ? cs.outerRingColor : cs.ringColor}" ` +
        `stroke-width="${isOuter ? 4 : 1.6}"/>`
      );
    }
  }

  out.push(`<circle cx="${round(geo.cx)}" cy="${round(geo.cy)}" r="4" fill="${cs.centerDotColor}"/>`);
  out.push('</g>');
  return out.join('\n');
}

function layoutSkillLabels(cfg, geo) {
  const L = cfg.layout;
  const cs = cfg.colorScheme;
  const gap = L.skillLabelGap;
  const placed = [];
  const pad = 3;

  for (const skill of geo.skills) {
    const rad = (skill.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const anchorPoint = polar(geo.cx, geo.cy, geo.r + gap, skill.angle);

    // Anchor away from the circle, so the text reads outwards. Near the vertical
    // axis the spoke may have crossed into the other half while its category's
    // band is on this side - there, follow the band, so the label lands on its
    // own category's colour instead of the neighbouring one.
    const bandSide = geo.sideOf.get(skill.category);
    let anchor = cos >= 0 ? 'start' : 'end';
    if (Math.abs(cos) < 0.25) anchor = bandSide === 'right' ? 'start' : 'end';
    const labelSide = anchor === 'start' ? 'right' : 'left';

    // Labels near the vertical axis have the whole canvas half-width to play
    // with; side labels only have their gutter. Wider means fewer wrapped lines,
    // which is what keeps the crowded top and bottom of the circle readable.
    const room = anchor === 'start'
      ? geo.W - L.margin - anchorPoint.x
      : anchorPoint.x - L.margin;
    const maxW = clamp(room, 90, geo.side * 1.7);

    const opts = {
      anchor,
      align: clamp(-sin / 0.8, -1, 1),
      fontSize: L.skillFontSize,
      lineHeightFactor: L.lineHeightFactor,
      color: cs.textColor
    };
    const lines = wrapText(skill.short || skill.name, maxW, L.skillFontSize, false);

    // Crowded spokes - the ones flanking the vertical axis - would otherwise
    // stack on top of each other. Slide the label along the canvas until it
    // clears whatever is already placed, away from the neighbour it hits.
    let y = anchorPoint.y;
    let block = layoutBlock(lines, anchorPoint.x, y, opts);
    for (let i = 0; i < 12; i++) {
      const hit = placed.find((other) => overlaps(block.box, other.box, pad));
      if (!hit) break;
      const blockMid = (block.box.y0 + block.box.y1) / 2;
      const hitMid = (hit.box.y0 + hit.box.y1) / 2;
      const dy = blockMid >= hitMid
        ? hit.box.y1 + pad - block.box.y0
        : hit.box.y0 - pad - block.box.y1;
      const moved = layoutBlock(lines, anchorPoint.x, y + dy, opts);
      if (moved.box.y0 < 2 || moved.box.y1 > geo.H - 2) break; // would leave the canvas
      y += dy;
      block = moved;
    }

    block.skill = skill.id;
    block.category = skill.category;
    block.side = labelSide;
    placed.push(block);
  }
  return placed;
}

function renderBlocks(blocks, className) {
  return `<g class="${className}">\n${blocks.map(drawBlock).join('\n')}\n</g>`;
}

function renderLevelLabels(cfg, geo) {
  if (!cfg.layout.showLevelLabels) return '';
  const L = cfg.layout;
  const cs = cfg.colorScheme;
  const out = ['<g class="level-labels">'];

  cfg.levels.forEach((level, i) => {
    const r = geo.levelRadius(i + 1);
    const y = geo.cy - r + L.levelFontSize * 1.15;
    const w = measureText(level.name, L.levelFontSize, true);
    out.push(
      `<rect x="${round(geo.cx - w / 2 - 8)}" y="${round(y - L.levelFontSize)}" ` +
      `width="${round(w + 16)}" height="${round(L.levelFontSize * 1.35)}" rx="4" ` +
      `fill="${cs.chartBackground || '#ffffff'}" opacity="0.72"/>`
    );
    out.push(
      `<text x="${round(geo.cx)}" y="${round(y)}" text-anchor="middle" font-weight="700" ` +
      `font-size="${L.levelFontSize}" fill="${cs.levelLabelColor}">${esc(level.name)}</text>`
    );
  });

  out.push('</g>');
  return out.join('\n');
}

function renderProfiles(cfg, geo) {
  const L = cfg.layout;
  const cs = cfg.colorScheme;
  const out = ['<g class="profiles">'];

  for (const profile of cfg.profiles) {
    const points = geo.skills.map((skill) => {
      const value = profile.values[skill.index] == null ? 0 : profile.values[skill.index];
      return polar(geo.cx, geo.cy, geo.levelRadius(value), skill.angle);
    });
    const fillOpacity = profile.fillOpacity != null ? profile.fillOpacity : cs.profileFillOpacity;
    const strokeWidth = profile.strokeWidth != null ? profile.strokeWidth : cs.profileStrokeWidth;

    out.push(
      `<polygon points="${polygonPoints(points)}" fill="${profile.color}" fill-opacity="${fillOpacity}" ` +
      `stroke="${profile.color}" stroke-width="${strokeWidth}" stroke-linejoin="round" ` +
      `stroke-linecap="round"${profile.strokeDasharray ? ` stroke-dasharray="${profile.strokeDasharray}"` : ''}/>`
    );

    if (L.showPoints) {
      for (const p of points) {
        out.push(`<circle cx="${round(p.x)}" cy="${round(p.y)}" r="${L.pointRadius}" fill="${profile.color}"/>`);
      }
    }
  }

  out.push('</g>');
  return out.join('\n');
}

function layoutProfileLegend(cfg, geo) {
  if (!cfg.layout.showProfileLegend) return null;
  const L = cfg.layout;
  const fs = L.legendFontSize;
  const rowH = fs * 1.75;
  const sample = 46;
  const padX = 18;
  const padY = 14;

  const textW = Math.max(...cfg.profiles.map((p) => measureText(p.name, fs, true)));
  const w = padX * 2 + sample + 14 + textW;
  const h = padY * 2 + rowH * cfg.profiles.length;

  const pos = String(L.legendPosition || 'bottom-right');
  const x = pos.includes('left') ? L.margin : geo.W - L.margin - w;
  const y = pos.includes('top')
    ? geo.titleH + L.margin
    : geo.H - geo.footerH - L.margin - h;

  return { x, y, w, h, fs, rowH, sample, padX, padY, box: { x0: x, y0: y, x1: x + w, y1: y + h } };
}

function renderProfileLegend(cfg, legend) {
  if (!legend) return '';
  const cs = cfg.colorScheme;
  const { x, y, w, h, fs, rowH, sample, padX, padY } = legend;
  const out = ['<g class="profile-legend">'];
  out.push(
    `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" ` +
    `fill="${cs.legendBackground}" stroke="${cs.legendBorder}" stroke-width="2"/>`
  );
  cfg.profiles.forEach((profile, i) => {
    const ry = y + padY + rowH * i + rowH / 2;
    out.push(
      `<line x1="${round(x + padX)}" y1="${round(ry)}" x2="${round(x + padX + sample)}" y2="${round(ry)}" ` +
      `stroke="${profile.color}" stroke-width="${cs.profileStrokeWidth}" stroke-linecap="round"` +
      `${profile.strokeDasharray ? ` stroke-dasharray="${profile.strokeDasharray}"` : ''}/>`
    );
    out.push(
      `<text x="${round(x + padX + sample + 14)}" y="${round(ry + fs * 0.35)}" font-size="${fs}" ` +
      `font-weight="700" fill="${cs.textColor}">${esc(profile.name)}</text>`
    );
  });
  out.push('</g>');
  return out.join('\n');
}

function renderLevelLegend(cfg, geo) {
  const legend = geo.levelLegend;
  if (!legend) return '';
  const cs = cfg.colorScheme;
  const { fs, lh } = legend;
  const top = geo.H - geo.footerH + cfg.layout.margin * 0.7;

  const out = ['<g class="level-legend">'];
  for (const entry of legend.entries) {
    out.push(
      `<text x="${round(entry.x)}" y="${round(top + fs)}" font-size="${fs}" font-weight="700" ` +
      `fill="${cs.textColor}">${esc(entry.label)}</text>`
    );
    entry.lines.forEach((line, j) => {
      out.push(
        `<text x="${round(entry.x + entry.labelW)}" y="${round(top + fs + j * lh)}" font-size="${fs}" ` +
        `fill="${cs.textColor}">${esc(line)}</text>`
      );
    });
  }
  out.push('</g>');
  return out.join('\n');
}

function renderTitle(cfg, geo) {
  if (!cfg.title) return '';
  const L = cfg.layout;
  const cs = cfg.colorScheme;
  const out = ['<g class="title">'];
  out.push(
    `<text x="${round(geo.W / 2)}" y="${round(L.margin + L.titleFontSize)}" text-anchor="middle" ` +
    `font-size="${L.titleFontSize}" font-weight="700" fill="${cs.textColor}">${esc(cfg.title)}</text>`
  );
  if (cfg.subtitle) {
    out.push(
      `<text x="${round(geo.W / 2)}" y="${round(L.margin + L.titleFontSize + L.subtitleFontSize + 10)}" ` +
      `text-anchor="middle" font-size="${L.subtitleFontSize}" fill="${cs.textColor}" ` +
      `opacity="0.75">${esc(cfg.subtitle)}</text>`
    );
  }
  out.push('</g>');
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function renderSvg(config) {
  const cfg = config;
  const L = cfg.layout;
  const cs = cfg.colorScheme;
  const geo = computeGeometry(cfg);
  const legend = layoutProfileLegend(cfg, geo);
  const skillLabels = layoutSkillLabels(cfg, geo);
  const bands = computeBands(cfg, geo, skillLabels);

  const obstacles = skillLabels.map((b) => b.box);
  if (legend) obstacles.push(legend.box);
  const bandLabels = layoutBandLabels(cfg, geo, bands, obstacles);

  const body = [
    renderDefs(cfg, geo, bands),
    `<rect width="${geo.W}" height="${geo.H}" fill="${cs.background}"/>`,
    renderBands(cfg, geo, bands),
    renderTitle(cfg, geo),
    renderGrid(cfg, geo),
    renderProfiles(cfg, geo),
    renderLevelLabels(cfg, geo),
    renderBlocks(skillLabels, 'skill-labels'),
    bandLabels.length ? renderBlocks(bandLabels, 'category-labels') : '',
    renderProfileLegend(cfg, legend),
    renderLevelLegend(cfg, geo)
  ].filter(Boolean).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.W}" height="${geo.H}" ` +
    `viewBox="0 0 ${geo.W} ${geo.H}" font-family="${esc(L.fontFamily)}">\n` +
    `<title>${esc(cfg.title || 'Skills radar chart')}</title>\n` +
    body +
    `\n</svg>\n`;
}

module.exports = { renderSvg, computeGeometry, computeBands, layoutSkillLabels, layoutLevelLegend };
