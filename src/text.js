'use strict';

/**
 * Crude but stable text metrics. We render plain SVG without access to real
 * font metrics, so widths are estimated from per-character ratios of the font
 * size. Good enough to wrap labels sensibly at any font size.
 */
const NARROW = "iljtfrIJ.,:;'\"|!()[]{}-` ";
const WIDE = 'mwMW@%';
const UPPER = 'ABCDEFGHKLNOPQRSTUVXYZ&';

function charRatio(ch) {
  if (NARROW.includes(ch)) return 0.3;
  if (WIDE.includes(ch)) return 0.87;
  if (UPPER.includes(ch)) return 0.68;
  if (ch >= '0' && ch <= '9') return 0.56;
  return 0.53;
}

function measureText(str, fontSize, bold) {
  let ratio = 0;
  for (const ch of String(str)) ratio += charRatio(ch);
  return ratio * fontSize * (bold ? 1.06 : 1);
}

/** Greedy word wrap to a pixel width. Never drops a word, even an over-long one. */
function wrapText(str, maxWidth, fontSize, bold) {
  const words = String(str).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = line + ' ' + words[i];
    if (measureText(candidate, fontSize, bold) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { measureText, wrapText, esc, charRatio };
