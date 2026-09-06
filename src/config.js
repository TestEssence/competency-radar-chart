'use strict';

const fs = require('fs');
const path = require('path');
const D = require('./defaults');

class ConfigError extends Error {
  constructor(errors) {
    super('Invalid configuration:\n  - ' + errors.join('\n  - '));
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

const slug = (s) => String(s).trim().toLowerCase().replace(/\s+/g, '-');

function normalizeLevels(raw, errors) {
  let levels = raw;
  if (levels == null) levels = D.LEVELS;
  if (typeof levels === 'number') {
    if (!Number.isInteger(levels) || levels < 2 || levels > 10) {
      errors.push(`levels: expected an integer between 2 and 10, got ${levels}`);
      return D.LEVELS.slice();
    }
    levels = Array.from({ length: levels }, (_, i) => ({ name: `Level ${i + 1}` }));
  }
  if (!Array.isArray(levels) || levels.length < 2) {
    errors.push('levels: expected an array of at least 2 level names/objects, or a count');
    return D.LEVELS.slice();
  }
  return levels.map((l, i) => {
    if (typeof l === 'string') return { name: l, description: '' };
    if (!l || !l.name) errors.push(`levels[${i}]: missing "name"`);
    return {
      name: String(l && l.name),
      description: l && l.description ? String(l.description) : ''
    };
  });
}

function normalizeCategories(raw, scheme, errors) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('categories: expected a non-empty array');
    return [];
  }
  const palette = scheme.categoryPalette;
  return raw.map((c, i) => {
    const obj = typeof c === 'string' ? { name: c } : c || {};
    if (!obj.name) errors.push(`categories[${i}]: missing "name"`);
    return {
      id: String(obj.id || obj.name || `category-${i}`),
      name: String(obj.name || obj.id || `Category ${i + 1}`),
      color: obj.color || palette[i % palette.length],
      index: i
    };
  });
}

/**
 * Skills accept two shapes:
 *   [{ name, category }, ...]
 *   { "Category name": ["skill", { name, id }], ... }
 * Either way they are regrouped into category order, so every category owns
 * one contiguous arc of the circle.
 */
function normalizeSkills(raw, categories, errors) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const byName = new Map(categories.map((c) => [c.name, c]));
  const bySlug = new Map(categories.map((c) => [slug(c.name), c]));
  const flat = [];

  const push = (entry, categoryRef, where) => {
    const obj = typeof entry === 'string' ? { name: entry } : entry || {};
    const catKey = categoryRef != null ? categoryRef : obj.category;
    const cat = byId.get(catKey) || byName.get(catKey) || bySlug.get(slug(catKey || ''));
    if (!obj.name) errors.push(`${where}: missing "name"`);
    if (!cat) {
      errors.push(`${where}: unknown category "${catKey}" (known: ${categories.map((c) => c.name).join(', ')})`);
      return;
    }
    flat.push({
      id: String(obj.id || obj.name || ''),
      name: String(obj.name || obj.id || ''),
      short: obj.short ? String(obj.short) : null,
      category: cat.id,
      categoryIndex: cat.index
    });
  };

  if (Array.isArray(raw)) {
    raw.forEach((s, i) => push(s, null, `skills[${i}]`));
  } else if (raw && typeof raw === 'object') {
    for (const [key, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) {
        errors.push(`skills["${key}"]: expected an array of skills`);
        continue;
      }
      list.forEach((s, i) => push(s, key, `skills["${key}"][${i}]`));
    }
  } else {
    errors.push('skills: expected an array, or a { category: [skills] } object');
    return [];
  }

  const seen = new Set();
  for (const s of flat) {
    if (seen.has(s.id)) {
      errors.push(`skills: duplicate skill id "${s.id}" - give one of them an explicit "id"`);
    }
    seen.add(s.id);
  }

  // Regroup by category order so each category is one contiguous arc.
  const ordered = [];
  for (const cat of categories) {
    const own = flat.filter((s) => s.category === cat.id);
    if (own.length === 0) errors.push(`categories: "${cat.name}" has no skills`);
    ordered.push(...own);
  }
  if (ordered.length < 3) {
    errors.push(`skills: need at least 3 skills to draw a radar, got ${ordered.length}`);
  }
  ordered.forEach((s, i) => { s.index = i; });
  return ordered;
}

function parseValue(value, levels, where, errors) {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      errors.push(`${where}: value is not a finite number`);
      return null;
    }
    if (value < 0 || value > levels.length) {
      errors.push(`${where}: value ${value} is outside 0..${levels.length}`);
      return Math.min(Math.max(value, 0), levels.length);
    }
    return value;
  }
  const str = String(value).trim();
  const num = Number(str);
  if (str !== '' && !Number.isNaN(num)) return parseValue(num, levels, where, errors);
  const idx = levels.findIndex((l) => slug(l.name) === slug(str));
  if (idx === -1) {
    errors.push(`${where}: "${str}" is not a level name (${levels.map((l) => l.name).join(', ')}) or a number`);
    return null;
  }
  return idx + 1;
}

function normalizeProfiles(raw, skills, levels, scheme, errors) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('profiles: expected a non-empty array');
    return [];
  }
  const byId = new Map(skills.map((s) => [s.id, s]));
  const byName = new Map(skills.map((s) => [s.name, s]));
  const bySlug = new Map(skills.map((s) => [slug(s.name), s]));
  const palette = scheme.profilePalette;

  return raw.map((p, i) => {
    const obj = p || {};
    const where = `profiles[${i}]`;
    if (!obj.name) errors.push(`${where}: missing "name"`);
    const values = new Array(skills.length).fill(null);
    const src = obj.values || obj.skills || {};
    if (typeof src !== 'object' || Array.isArray(src)) {
      errors.push(`${where}.values: expected a { "skill": level } object`);
    } else {
      for (const [key, value] of Object.entries(src)) {
        const skill = byId.get(key) || byName.get(key) || bySlug.get(slug(key));
        if (!skill) {
          errors.push(`${where}.values: unknown skill "${key}"`);
          continue;
        }
        values[skill.index] = parseValue(value, levels, `${where}.values["${key}"]`, errors);
      }
    }
    return {
      id: String(obj.id || obj.name || `profile-${i}`),
      name: String(obj.name || `Profile ${i + 1}`),
      color: obj.color || palette[i % palette.length],
      fillOpacity: obj.fillOpacity,
      strokeWidth: obj.strokeWidth,
      strokeDasharray: obj.strokeDasharray || null,
      values
    };
  });
}

function normalize(raw) {
  const input = raw || {};
  const errors = [];

  const orientation = String(input.orientation || 'landscape').toLowerCase();
  if (orientation !== 'landscape' && orientation !== 'portrait') {
    errors.push(`orientation: expected "landscape" or "portrait", got "${input.orientation}"`);
  }
  const size = D.SIZES[orientation] || D.SIZES.landscape;

  const colorScheme = Object.assign({}, D.COLOR_SCHEME, input.colorScheme || input.colors || {});
  if (!Array.isArray(colorScheme.categoryPalette) || !colorScheme.categoryPalette.length) {
    colorScheme.categoryPalette = D.PALETTE;
  }
  if (!Array.isArray(colorScheme.profilePalette) || !colorScheme.profilePalette.length) {
    colorScheme.profilePalette = D.PROFILE_PALETTE;
  }

  const layout = Object.assign({}, D.LAYOUT, input.layout || {});
  if (layout.skillLabelSpace == null) layout.skillLabelSpace = size.skillLabelSpace;

  const levels = normalizeLevels(input.levels, errors);
  const categories = normalizeCategories(input.categories, colorScheme, errors);
  const skills = categories.length ? normalizeSkills(input.skills, categories, errors) : [];
  const profiles = skills.length ? normalizeProfiles(input.profiles, skills, levels, colorScheme, errors) : [];

  const width = Number(input.width || size.width);
  const height = Number(input.height || size.height);
  if (!Number.isFinite(width) || width < 200) errors.push(`width: expected a number >= 200, got ${input.width}`);
  if (!Number.isFinite(height) || height < 200) errors.push(`height: expected a number >= 200, got ${input.height}`);

  if (errors.length) throw new ConfigError(errors);

  return {
    title: input.title ? String(input.title) : null,
    subtitle: input.subtitle ? String(input.subtitle) : null,
    orientation,
    width,
    height,
    levels,
    categories,
    skills,
    profiles,
    colorScheme,
    layout
  };
}

function loadConfig(file) {
  const abs = path.resolve(file);
  if (/\.js$/i.test(abs)) return require(abs);
  const text = fs.readFileSync(abs, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Could not parse ${abs} as JSON: ${err.message}`);
  }
}

module.exports = { normalize, loadConfig, ConfigError, slug };
