// `v1design detect` — the AI-slop linter. Tier-0, deterministic, ZERO model cost,
// ZERO auth: it never calls credentials() or the v-1 backend, so anyone can `npx`
// it on their own repo and check their UI from inside their own coding agent.
//
// It scans source (.tsx/.jsx/.ts/.js/.css/.html) for the "tells" that make
// AI-generated frontends all look the same — the same checklist the v-1 engine
// jury uses (BLAND-TELL in engine critic.ts) plus the mechanizable anti-patterns
// popularised by impeccable.style. Each finding is a SlopTell, mirroring the shape
// the engine's /slop hall stores, so the vocabulary stays consistent across both.
//
// HARD tells (the loudest "this is AI slop" signals) set a non-zero exit code so it
// gates in CI. SOFT tells are warnings — many are defensible in context (warm/cream
// palettes, a single bounce) so they never fail the run, only flag.
import { readFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const WEB_URL = (process.env.V1_DESIGN_WEB_URL || "https://v-1.design").replace(/\/+$/, "");
const SCAN_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".css", ".html", ".htm"]);
const SKIP_DIR = new Set(["node_modules", ".next", ".git", "dist", "build", "out", ".v1design", ".turbo", "coverage", ".vercel"]);
const MAX_FILES = 4000;

// ── rule helpers ──────────────────────────────────────────────────────────
// Every rule is a pure function (src, file) → [{ line, snippet }]. A rule fires
// when it returns at least one hit. `severity` decides whether it gates (hard) or
// just warns (soft). `note` is the one-line "why it's a tell + how to fix" line.

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** All non-overlapping matches of a global regex, with 1-based line numbers. */
function hits(src, re) {
  const out = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = rx.exec(src))) {
    out.push({ line: lineOf(src, m.index), snippet: m[0].slice(0, 80).replace(/\s+/g, " ").trim() });
    if (m.index === rx.lastIndex) rx.lastIndex++;
    if (out.length >= 50) break;
  }
  return out;
}

/** Visible JSX/HTML text only (strip tags + attributes) — for copy-level tells. */
function visibleText(src) {
  return src
    .replace(/<[^>]+>/g, " ")
    .replace(/className=("[^"]*"|'[^']*'|\{[^}]*\})/g, " ")
    .replace(/\b(import|from|const|export)\b[^\n]*/g, " ");
}

const RULES = [
  // ── color ────────────────────────────────────────────────────────────
  {
    key: "purple-gradient", name: "Purple/violet→blue gradient", severity: "hard", cat: "Color",
    note: "The single most recognisable AI tell (indigo/violet → blue). Commit to ONE brand hue, or a token gradient, instead.",
    test: (s) => {
      if (!/bg-gradient-to|linear-gradient|radial-gradient/.test(s)) return [];
      const purple = hits(s, /(from|via|to)-(indigo|violet|purple|fuchsia)-\d{2,3}/);
      const cool = /(from|via|to)-(blue|sky|cyan|indigo|violet|purple)-\d{2,3}/.test(s);
      return purple.length && cool ? purple : [];
    },
  },
  {
    key: "gradient-text", name: "Gradient text", severity: "soft", cat: "Color",
    note: "Gradient-filled headings are decorative, not meaningful, and hurt legibility. Use a solid token color.",
    test: (s) => (/(bg-clip-text|background-clip:\s*text)/.test(s) && /(text-transparent|color:\s*transparent)/.test(s) ? hits(s, /text-transparent|bg-clip-text/) : []),
  },
  {
    key: "dark-glow", name: "Neon glow on dark", severity: "soft", cat: "Color",
    note: "Colored box-shadow 'glows' on dark backgrounds read as generated. Earn depth with token color-mix shadows instead.",
    test: (s) => hits(s, /shadow-\[0_0_\d+px[^\]]*\]|drop-shadow-\[0_0_\d+px/),
  },

  // ── typography ───────────────────────────────────────────────────────
  {
    key: "overused-font", name: "Overused font (Inter / Geist / Space Grotesk)", severity: "soft", cat: "Type",
    note: "These are the default AI typefaces. A distinctive display face is the cheapest way to not look generated.",
    test: (s) => hits(s, /["'`](Inter|Geist(?:\s*Mono)?|Space\s*Grotesk)["'`]|font-(inter|geist)\b/),
  },
  {
    key: "tiny-body", name: "Sub-12px body text", severity: "hard", cat: "Type",
    note: "Text under 12px is hard to read and fails most a11y bars. Floor body at 14–16px.",
    test: (s) => hits(s, /text-\[(?:[0-9]|1[01])px\]|font-size:\s*(?:[0-9]|1[01])px/),
  },
  {
    key: "tight-leading", name: "Line-height below ~1.3 on body text", severity: "soft", cat: "Type",
    note: "Cramped leading makes body copy hard to read. Use leading-relaxed / line-height ≥ 1.4 for prose. (Tight leading on a big display heading is fine.)",
    test: (s) => {
      const re = /leading-none|leading-\[1(?:\.[012]\d*)?\]|line-height:\s*1(?:\.[012]\d*)?(?:;|\s|$)/g;
      const lines = s.split("\n");
      const out = [];
      let m;
      while ((m = re.exec(s))) {
        const ln = lineOf(s, m.index);
        const lineText = lines[ln - 1] || "";
        // Tight leading on a DISPLAY heading is correct, not a tell — only flag body/prose.
        if (/clamp\(|\bvw\b|text-(5xl|6xl|7xl|8xl|9xl)|text-\[(?:3[2-9]|[4-9]\d|\d{3,})px\]|tracking-tight|<h1|font-display/.test(lineText)) continue;
        out.push({ line: ln, snippet: m[0].slice(0, 80) });
        if (out.length >= 50) break;
      }
      return out;
    },
  },
  {
    key: "italic-serif-hero", name: "Italic-serif hero headline", severity: "soft", cat: "Type",
    note: "The italic-serif hero has become the universal AI-startup landing page. Commit to a real type personality.",
    test: (s) => hits(s, /class[^=]*=["'][^"']*\bitalic\b[^"']*\b(font-serif|serif)\b|\b(font-serif|serif)\b[^"']*\bitalic\b/),
  },

  // ── layout & space ───────────────────────────────────────────────────
  {
    key: "side-tab-border", name: "Side-tab accent border", severity: "soft", cat: "Layout",
    note: "A thick colored stripe down one side of a card is a classic AI tell. Use a full token surface or restraint.",
    test: (s) => hits(s, /border-l-(4|8|\[\d)|border-l-\[\dpx\][^"']*(primary|accent|indigo|violet|purple)/),
  },
  {
    key: "blob-radius", name: "Extreme border-radius (44px+ blob)", severity: "soft", cat: "Layout",
    note: "Over-rounding turns every card into the same blob. Pick a radius scale and hold it.",
    test: (s) => hits(s, /rounded-\[(?:[4-9]\d|\d{3,})px\]|rounded-\[(?:[3-9](?:\.\d+)?)rem\]|border-radius:\s*(?:[4-9]\d|\d{3,})px/),
  },
  {
    key: "glassmorphism", name: "Glassmorphism everywhere", severity: "soft", cat: "Layout",
    note: "Frosted backdrop-blur panels used as decoration are an overused tell. Reserve glass for one intentional surface.",
    test: (s) => { const b = hits(s, /backdrop-blur(-\w+)?/); return b.length >= 2 ? b : []; },
  },

  // ── motion ───────────────────────────────────────────────────────────
  {
    key: "bounce-easing", name: "Bounce / elastic easing", severity: "soft", cat: "Motion",
    note: "Bounce and elastic easing on UI feels dated. Use a calm ease-out for interface motion.",
    test: (s) => hits(s, /animate-bounce|cubic-bezier\([^)]*1\.[2-9]|elastic|easeOutBounce/),
  },
  {
    key: "layout-anim", name: "transition-all (animates layout props)", severity: "soft", cat: "Motion",
    note: "transition-all animates width/height/padding and causes jank. Transition only color/opacity/transform.",
    test: (s) => hits(s, /transition-all\b/),
  },

  // ── copy ─────────────────────────────────────────────────────────────
  {
    key: "generic-cta", name: "Generic CTA", severity: "hard", cat: "Copy",
    note: "{Get Started, Learn More, Sign up free, Click here, Welcome back} is filler. Write a first-person, specific CTA.",
    test: (s) => hits(visibleText(s), /\b(Get Started|Learn More|Sign up free|Click here|Welcome back|Your dashboard)\b/),
  },
  {
    key: "placeholder-data", name: "Placeholder data", severity: "hard", cat: "Copy",
    note: "Lorem / John Doe / Item 1 / $0.00 / Card title is the loudest AI-demo tell. Use real, non-round, consistent data.",
    test: (s) => hits(visibleText(s), /\bLorem ipsum\b|\bJohn Doe\b|\bItem [123]\b|\$0\.00\b|\bCard title\b|\bYour Company\b|\bexample@example\.com\b/i),
  },
  {
    key: "buzzwords", name: "Marketing buzzwords", severity: "soft", cat: "Copy",
    note: "streamline / empower / supercharge / seamless / unlock / revolutionize read as generated. Say the concrete thing.",
    test: (s) => hits(visibleText(s), /\b(streamline|empower|supercharge|seamless(?:ly)?|unlock your|revolutioni[sz]e|elevate your|game-?changer)\b/i),
  },
  {
    key: "em-dash-overuse", name: "Em-dash cadence", severity: "soft", cat: "Copy",
    note: "More than a couple of em-dashes in body copy is AI cadence. Vary the sentence rhythm.",
    test: (s) => { const all = hits(visibleText(s), /—/); return all.length > 3 ? all.slice(0, 6) : []; },
  },

  // ── imagery & a11y ───────────────────────────────────────────────────
  {
    key: "empty-img", name: "Empty / placeholder image", severity: "hard", cat: "Imagery",
    note: "An <img> with no real src ships broken. Use a real asset or remove it.",
    test: (s) => hits(s, /<img\b[^>]*\bsrc=("\s*"|'\s*'|\{?["'`]?\s*(#|TODO|placeholder)["'`]?\}?)/i),
  },
  {
    key: "placeholder-img-service", name: "Placeholder image service", severity: "soft", cat: "Imagery",
    note: "placehold.co / via.placeholder / picsum stand-ins read as unfinished. Swap in real imagery before shipping.",
    test: (s) => hits(s, /placehold\.co|via\.placeholder|placekitten|picsum\.photos|dummyimage\.com/),
  },
  {
    key: "skipped-heading", name: "Skipped heading level (h1 → h3)", severity: "soft", cat: "A11y",
    note: "Jumping h1→h3 breaks document structure and screen-reader order. Don't skip levels.",
    test: (s) => {
      const h1 = s.indexOf("<h1"), h3 = s.indexOf("<h3");
      return h1 >= 0 && h3 >= 0 && !/<h2[\s>]/.test(s) ? [{ line: lineOf(s, h3), snippet: "<h3> with no <h2> above it" }] : [];
    },
  },
];

// ── scan ────────────────────────────────────────────────────────────────
async function collectFiles(root) {
  const files = [];
  async function walk(dir) {
    if (files.length >= MAX_FILES) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.startsWith(".")) await walk(p); continue; }
      if (SCAN_EXT.has(extname(e.name))) files.push(p);
    }
  }
  if (statSync(root).isFile()) return [root];
  await walk(root);
  return files;
}

/**
 * Scan a directory (or file) and return a deterministic slop report.
 * Pure + local: no auth, no network, no model.
 */
export async function detectProject(target) {
  const root = target || process.cwd();
  const files = await collectFiles(root);
  // Accumulate per-rule across the whole tree so the report reads by tell, not by file.
  const acc = new Map(RULES.map((r) => [r.key, { rule: r, occurrences: [] }]));
  for (const f of files) {
    let src = "";
    try { src = await readFile(f, "utf8"); } catch { continue; }
    if (src.length > 400_000) continue;
    const rel = relative(root, f) || f;
    for (const r of RULES) {
      let found = [];
      try { found = r.test(src) || []; } catch { found = []; }
      for (const h of found) acc.get(r.key).occurrences.push({ file: rel, line: h.line, snippet: h.snippet });
    }
  }

  const tells = [];
  for (const { rule, occurrences } of acc.values()) {
    const fired = occurrences.length > 0;
    tells.push({
      key: rule.key,
      name: rule.name,
      cat: rule.cat,
      severity: rule.severity,
      fired,
      points: fired ? (rule.severity === "hard" ? 0 : 1) : 2,
      max: 2,
      note: rule.note,
      count: occurrences.length,
      occurrences: occurrences.slice(0, 12),
    });
  }
  const hard = tells.filter((t) => t.fired && t.severity === "hard");
  const soft = tells.filter((t) => t.fired && t.severity === "soft");
  return { target: root, filesScanned: files.length, ruleCount: RULES.length, hard, soft, tells, clean: hard.length === 0 && soft.length === 0 };
}

// ── output ────────────────────────────────────────────────────────────────
const C = { dim: "\x1b[2m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", bold: "\x1b[1m", reset: "\x1b[0m" };
const paint = (on) => (c, s) => (on ? c + s + C.reset : s);

function printTell(t, p) {
  const tag = t.severity === "hard" ? p(C.red, "● HARD") : p(C.yellow, "○ warn");
  console.log(`  ${tag} ${p(C.bold, t.name)} ${p(C.dim, `(${t.count}×)`)}`);
  console.log(`        ${p(C.dim, t.note)}`);
  for (const o of t.occurrences.slice(0, 5)) console.log(`        ${p(C.dim, `${o.file}:${o.line}`)}`);
  if (t.count > 5) console.log(`        ${p(C.dim, `… +${t.count - 5} more`)}`);
}

/** CLI entry for `v1design detect [dir]`. */
export async function detectCommand(target, flags = {}) {
  if (flags.tells) {
    console.log(`v1design detect — ${RULES.length} deterministic slop rules:\n`);
    for (const r of RULES) console.log(`  ${r.severity === "hard" ? "●" : "○"} ${r.key.padEnd(24)} ${r.name}`);
    console.log(`\n● = hard (fails the run)   ○ = soft (warning)`);
    return;
  }

  const report = await detectProject(target);
  if (flags.json) { console.log(JSON.stringify(report, null, 2)); if (report.hard.length) process.exitCode = 1; return report; }

  const p = paint(process.stdout.isTTY && !process.env.NO_COLOR);
  console.log("");
  console.log(p(C.bold, `v1design detect`) + p(C.dim, `  ·  ${report.filesScanned} files  ·  ${report.ruleCount} rules`));
  console.log("");

  if (report.clean) {
    console.log(p(C.green, "  ✓ No AI-slop tells found. Clean.") + "\n");
  } else {
    if (report.hard.length) { console.log(p(C.red, p(C.bold, `  ${report.hard.length} hard tell(s) — these read as AI slop:`)) + "\n"); for (const t of report.hard) { printTell(t, p); console.log(""); } }
    if (report.soft.length) { console.log(p(C.yellow, `  ${report.soft.length} soft tell(s) — worth a look:`) + "\n"); for (const t of report.soft) { printTell(t, p); console.log(""); } }
  }

  const n = report.hard.length + report.soft.length;
  console.log(p(C.dim, "  ──────────────────────────────────────────────"));
  console.log(p(C.dim, `  ${n === 0 ? "0 tells" : `${n} tell(s)`} · for done-for-you, jury-graded designs see ${WEB_URL}`));
  console.log("");

  if (report.hard.length) process.exitCode = 1;
  return report;
}
