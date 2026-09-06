'use strict';

const DEG = Math.PI / 180;

/** Point on a circle. 0deg = right, -90deg = top, angles grow clockwise. */
function polar(cx, cy, r, angleDeg) {
  const a = angleDeg * DEG;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/** Pie slice from the centre, spanning [a0, a1] degrees clockwise. */
function sectorPath(cx, cy, r, a0, a1) {
  const span = a1 - a0;
  if (span >= 359.999) {
    // Full circle: two arcs, since a single arc cannot close on itself.
    const t = polar(cx, cy, r, 0);
    const b = polar(cx, cy, r, 180);
    return `M ${round(t.x)} ${round(t.y)} A ${round(r)} ${round(r)} 0 1 1 ${round(b.x)} ${round(b.y)}` +
      ` A ${round(r)} ${round(r)} 0 1 1 ${round(t.x)} ${round(t.y)} Z`;
  }
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const largeArc = span > 180 ? 1 : 0;
  return `M ${round(cx)} ${round(cy)} L ${round(p0.x)} ${round(p0.y)}` +
    ` A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${round(p1.x)} ${round(p1.y)} Z`;
}

function polygonPoints(points) {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

/** Normalise an angle into [min, min + 360). */
function normAngle(angle, min) {
  let a = angle;
  while (a < min) a += 360;
  while (a >= min + 360) a -= 360;
  return a;
}

module.exports = { polar, sectorPath, polygonPoints, normAngle, round, DEG };
