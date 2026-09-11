// Pure JS port of camera_engine.py's spline/ease math — kept numerically
// identical to the Python implementation (including its quirks, e.g. the
// linear-interpolation branch of the fov scalar NOT being clamped to
// [15,90] the way the Catmull-Rom branch is) so the 3D path preview matches
// exactly what the server bakes into the rendered camera guide video.
// No DOM/THREE dependency — safe to eyeball line-for-line against
// camera_engine.py, and reusable for both the path-curve line and the
// scrub-time preview.

export const DEFAULT_EASE = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
export const DEFAULT_POSE = { time: 0, position: [0, 1.85, 7], target: [0, 1.65, 0], fov: 42 };

export function normalizeEase(ease) {
  let e;
  try {
    e = (ease || []).map(Number);
    if (e.length !== 4 || e.some((x) => Number.isNaN(x))) throw new Error("bad ease");
  } catch (err) {
    e = DEFAULT_EASE.slice();
  }
  let [x1, y1, x2, y2] = e;
  x1 = Math.max(0, Math.min(1, x1)); y1 = Math.max(0, Math.min(1, y1));
  x2 = Math.max(0, Math.min(1, x2)); y2 = Math.max(0, Math.min(1, y2));
  if (x1 > x2) { const m = (x1 + x2) * 0.5; x1 = x2 = m; }
  return [x1, y1, x2, y2];
}

function bez1(t, a, b) {
  const mt = 1 - t;
  return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t;
}

function bez1d(t, a, b) {
  const mt = 1 - t;
  return 3 * mt * mt * a + 6 * mt * t * (b - a) + 3 * t * t * (1 - b);
}

export function easeProgress(u, ease) {
  u = Math.max(0, Math.min(1, u));
  const [x1, y1, x2, y2] = normalizeEase(ease);
  if (Math.abs(x1 - y1) < 1e-6 && Math.abs(x2 - y2) < 1e-6) return u;
  let t = u;
  for (let i = 0; i < 7; i++) {
    const err = bez1(t, x1, x2) - u;
    const der = bez1d(t, x1, x2);
    if (Math.abs(err) < 1e-7 || Math.abs(der) < 1e-8) break;
    t = Math.max(0, Math.min(1, t - err / der));
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const x = bez1(t, x1, x2);
    if (Math.abs(x - u) < 1e-7) break;
    if (x < u) lo = t; else hi = t;
    t = (lo + hi) * 0.5;
  }
  return Math.max(0, Math.min(1, bez1(t, y1, y2)));
}

function catmullRom3(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * (
      (2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
    );
  }
  return out;
}

function findSegment(keys, t) {
  let i = 0;
  while (i < keys.length - 1 && t > keys[i + 1].time) i++;
  return i;
}

export function interpVec3(keys, t, field, smooth = true) {
  if (!keys || !keys.length) return DEFAULT_POSE[field].slice();
  if (keys.length === 1) return keys[0][field].slice();
  if (t <= keys[0].time) return keys[0][field].slice();
  if (t >= keys[keys.length - 1].time) return keys[keys.length - 1][field].slice();
  const i = findSegment(keys, t);
  const a = keys[i], b = keys[i + 1];
  const uRaw = (t - a.time) / Math.max(1e-9, b.time - a.time);
  const u = easeProgress(uRaw, a.ease || DEFAULT_EASE);
  if (!smooth || keys.length < 3) {
    return [0, 1, 2].map((k) => a[field][k] * (1 - u) + b[field][k] * u);
  }
  const p0 = keys[Math.max(0, i - 1)][field];
  const p1 = a[field], p2 = b[field];
  const p3 = keys[Math.min(keys.length - 1, i + 2)][field];
  return catmullRom3(p0, p1, p2, p3, u);
}

// Matches camera_engine.py's _interp_scalar exactly, quirk included: the
// linear (non-smooth) branch does NOT clamp to [15,90] — only the
// Catmull-Rom branch does. Not "fixed" here on purpose; the point of this
// module is numeric parity with the backend, not correcting it.
export function interpScalarFov(keys, t, smooth = true) {
  if (!keys || !keys.length) return DEFAULT_POSE.fov;
  const vals = keys.map((k) => Number(k.fov));
  if (keys.length === 1) return vals[0];
  if (t <= keys[0].time) return vals[0];
  if (t >= keys[keys.length - 1].time) return vals[vals.length - 1];
  const i = findSegment(keys, t);
  const a = keys[i], b = keys[i + 1];
  const uRaw = (t - a.time) / Math.max(1e-9, b.time - a.time);
  const u = easeProgress(uRaw, a.ease || DEFAULT_EASE);
  if (!smooth || keys.length < 3) {
    return Number(a.fov) * (1 - u) + Number(b.fov) * u;
  }
  const p0 = Number(keys[Math.max(0, i - 1)].fov);
  const p1 = Number(a.fov), p2 = Number(b.fov);
  const p3 = Number(keys[Math.min(keys.length - 1, i + 2)].fov);
  const u2 = u * u, u3 = u2 * u;
  const v = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  return Math.max(15, Math.min(90, v));
}

// No Python equivalent — the backend renders every frame instead of
// sampling a line. Used to build the 3D path-curve geometry.
export function sampleCurve(keys, duration, smooth, samples = 100) {
  const out = [];
  if (!keys || !keys.length) return out;
  for (let i = 0; i <= samples; i++) {
    const t = (duration * i) / samples;
    out.push({ t, position: interpVec3(keys, t, "position", smooth) });
  }
  return out;
}
