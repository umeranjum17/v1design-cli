// Turn a studio screen's (already cleaned) TSX into a real, runnable route
// component. The engine has stripped studio scaffolding; the remaining work is
// small and deterministic: client directive, full-viewport, phone-column for
// mobile-on-web, and detection of CDN globals the screen depends on.

const CDN_GLOBALS = [
  // window global → CDN script(s) to inject in <head> (order matters)
  { test: /\bwindow\.THREE\b|\bnew\s+THREE\b/, scripts: ["https://unpkg.com/three@0.160.0/build/three.min.js"], key: "three" },
  { test: /\bnew\s+Lenis\b|\bwindow\.Lenis\b/, scripts: ["https://unpkg.com/lenis@1.1.13/dist/lenis.min.js"], key: "lenis" },
  { test: /\bwindow\.gsap\b|\bgsap\./, scripts: ["https://unpkg.com/gsap@3.12.5/dist/gsap.min.js"], key: "gsap" },
  { test: /\bwindow\.Matter\b/, scripts: ["https://unpkg.com/matter-js@0.20.0/build/matter.min.js"], key: "matter" },
  { test: /\bwindow\.confetti\b/, scripts: ["https://unpkg.com/canvas-confetti@1.9.3/dist/confetti.browser.js"], key: "confetti" },
];

const HOOK_RE = /\buse(State|Effect|Ref|Memo|Reducer|Callback|LayoutEffect)\b/;
const HANDLER_RE = /\bon[A-Z][a-zA-Z]+=\{/;

/** Which CDN globals does this screen code depend on? */
export function detectCdnGlobals(code) {
  const found = [];
  for (const g of CDN_GLOBALS) {
    if (g.test.test(code)) found.push(g);
  }
  return found;
}

/** Collect, de-duped, the CDN scripts needed across all screens. */
export function collectCdnScripts(screens) {
  const seen = new Set();
  const scripts = [];
  for (const s of screens) {
    for (const g of detectCdnGlobals(s.code || "")) {
      if (seen.has(g.key)) continue;
      seen.add(g.key);
      scripts.push(...g.scripts);
    }
  }
  return scripts;
}

function needsClientDirective(code) {
  return HOOK_RE.test(code) || HANDLER_RE.test(code);
}

function hasClientDirective(code) {
  return /^\s*["']use client["']/.test(code);
}

/**
 * Transform one screen for the web (Next App Router).
 * Returns the file contents for components/screens/<Name>.tsx.
 */
export function transformScreenWeb(code, screen) {
  let out = String(code || "").trim();
  if (!out) {
    return `export default function ${screen.componentName || "Screen"}() {\n  return null;\n}\n`;
  }

  // "use client" — these screens use hooks/effects/handlers under App Router.
  if (needsClientDirective(out) && !hasClientDirective(out)) {
    out = `"use client";\n\n${out}`;
  }

  // Unique, descriptive component name (default export preserved).
  const name = screen.componentName || "Screen";
  out = out.replace(/export default function\s+Screen\b/, `export default function ${name}`);

  // NOTE: design adaptations (full-bleed/full-width, nav-link wiring, font
  // fallback, contrast, tab-bar polish) are deliberately NOT hardcoded here —
  // they're per-project judgments the agent makes per the skill, enforced by the
  // gate. See skills/v1-design (Polish & port) + verify/grade.
  return out.endsWith("\n") ? out : out + "\n";
}

/**
 * The route file app/<kebab>/page.tsx that mounts a screen full-viewport.
 * For mobile-surface screens scaffolded to web, wrap in a centered phone column
 * so a phone design doesn't stretch to 1440.
 */
export function routeFile(screen, importPath) {
  const phone = screen.surface === "mobile";
  const wrapClass = phone
    ? "mx-auto w-full max-w-[440px] min-h-dvh"
    : "min-h-dvh w-full";
  return `import ${screen.componentName} from "${importPath}";

export default function Page() {
  return (
    <main className="${wrapClass}">
      <${screen.componentName} />
    </main>
  );
}
`;
}
