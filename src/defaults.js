'use strict';

/** Fallback category palette, used when a category declares no colour. */
const PALETTE = [
  '#c9a86a', '#b9bcbd', '#5f9e93', '#e6b73f', '#b23a3a',
  '#7a6ea8', '#4f86c6', '#d1793f', '#6f9e4c', '#a8577f'
];

/** Fallback profile palette. */
const PROFILE_PALETTE = [
  '#1f9c2e', '#e8231a', '#1f6fd0', '#8a2be2', '#e08a00', '#00868b'
];

const COLOR_SCHEME = {
  background: '#f2efe9',
  chartBackground: '#ffffff',
  ringColor: '#9a9a9a',
  outerRingColor: '#8c8c8c',
  spokeColor: '#b3b3b3',
  centerDotColor: '#b09a72',
  textColor: '#231f20',
  categoryLabelColor: '#ffffff',
  levelLabelColor: '#231f20',
  legendBackground: '#ffffff',
  legendBorder: '#231f20',
  categoryPalette: PALETTE,
  profilePalette: PROFILE_PALETTE,
  wedgeOpacity: 0.55,
  bandOpacity: 0.95,
  profileFillOpacity: 0.16,
  profileStrokeWidth: 4
};

const LAYOUT = {
  fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  margin: 26,
  chartPadding: 14,
  radiusScale: 1,
  /** Fraction of the canvas width reserved on each side for skill labels. */
  skillLabelSpace: null,
  skillFontSize: 21,
  skillLabelGap: 14,
  categoryFontSize: 26,
  levelFontSize: 24,
  legendFontSize: 21,
  footerFontSize: 20,
  titleFontSize: 34,
  subtitleFontSize: 21,
  titleHeight: 74,
  footerHeight: 92,
  lineHeightFactor: 1.16,
  /** Where the first skill sits: -90 = straight up. */
  startAngle: -90,
  /** Extra rotation in *steps*; 0.5 puts a gap on the vertical axis for the level labels. */
  angleOffset: 0.5,
  showBands: true,
  showWedges: true,
  showRings: true,
  showSpokes: true,
  showLevelLabels: true,
  showPoints: false,
  pointRadius: 5,
  showProfileLegend: true,
  showLevelLegend: true,
  legendPosition: 'bottom-right'
};

const LEVELS = [
  { name: 'Basic', description: 'knows about' },
  { name: 'Advanced', description: 'can apply' },
  { name: 'Expert', description: 'drives, coaches and is able to improve in own domain & scope' }
];

const SIZES = {
  landscape: { width: 1800, height: 1000, skillLabelSpace: 0.26 },
  portrait: { width: 1200, height: 1450, skillLabelSpace: 0.215 }
};

module.exports = { COLOR_SCHEME, LAYOUT, LEVELS, SIZES, PALETTE, PROFILE_PALETTE };
