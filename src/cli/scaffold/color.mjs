// Minimal OKLCH → sRGB hex conversion (Björn Ottosson's OKLab math). Used to
// bake hex token values into the Expo theme, since React Native cannot render
// oklch() color strings. Falls back to passing the value through unchanged.

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function linearToSrgb(c) {
  c = clamp01(c);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Parse "oklch(L C H / a)" where L may be a percentage. Returns [L,C,H,a] or null. */
function parseOklch(str) {
  const m = String(str).match(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  let L = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  let a = m[4] == null ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
  return [L, C, H, a];
}

/** Convert an oklch() string to #rrggbb (or rgba() if alpha < 1). Pass-through otherwise. */
export function oklchToHex(value) {
  const parsed = parseOklch(value);
  if (!parsed) return value;
  const [L, C, Hdeg, alpha] = parsed;
  const h = (Hdeg * Math.PI) / 180;
  const a = Math.cos(h) * C;
  const b = Math.sin(h) * C;

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);

  const to255 = (x) => Math.round(clamp01(x) * 255);
  const R = to255(r), G = to255(g), B = to255(bl);
  if (alpha < 1) return `rgba(${R}, ${G}, ${B}, ${Number(alpha.toFixed(3))})`;
  const hex = (n) => n.toString(16).padStart(2, "0");
  return `#${hex(R)}${hex(G)}${hex(B)}`;
}

/** Convert a semantic token map (camelCase keys, oklch values) to hex values. */
export function semanticToHex(semantic = {}) {
  const out = {};
  for (const [k, v] of Object.entries(semantic)) out[k] = oklchToHex(v);
  return out;
}
