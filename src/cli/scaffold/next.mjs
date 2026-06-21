// Build a runnable Next.js (App Router + Tailwind v4 + TS) project from a
// v-1.design handoff. Returns a { path: contents } map; the orchestrator writes
// it. Consumes artifacts.globalsCss/layoutTsx verbatim and only patches the
// <head> with the design's fonts + any CDN globals the screens depend on.
import { kebab, pascal } from "../lib/engine.mjs";
import {
  GITIGNORE, nextPackageJson, NEXT_CONFIG, POSTCSS_CONFIG, NEXT_TSCONFIG, NEXT_ENV_DTS,
} from "./templates.mjs";
import { transformScreenWeb, routeFile, collectCdnScripts } from "./transform.mjs";

/** A robust Google Fonts <link> set — one family per link so one bad family
 *  never breaks the others, and no weight axis (always a valid request). */
function fontLinks(typography) {
  const families = [];
  if (typography?.fontDisplay) families.push(typography.fontDisplay);
  if (typography?.fontBody && typography.fontBody !== typography.fontDisplay) families.push(typography.fontBody);
  const links = [
    `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />`,
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" />`,
  ];
  for (const fam of families) {
    const q = encodeURIComponent(fam).replace(/%20/g, "+");
    links.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${q}&display=swap" />`);
  }
  return links;
}

/** Inject font links + CDN scripts into the handoff's layout <head>. */
function patchLayout(layoutTsx, typography, cdnScripts) {
  const fonts = fontLinks(typography).map((l) => `        ${l}`).join("\n");
  const cdn = cdnScripts.map((src) => `        <script src="${src}" async={false}></script>`).join("\n");
  const injection = [fonts, cdn].filter(Boolean).join("\n");

  let out = String(layoutTsx || "").trim();
  if (out.includes("<head>")) {
    out = out.replace("<head>", `<head>\n${injection}`);
  } else if (out.includes("<body>")) {
    out = out.replace("<body>", `<head>\n${injection}\n      </head>\n      <body>`);
  }
  return out.endsWith("\n") ? out : out + "\n";
}

const FALLBACK_LAYOUT = (typography, cdnScripts) => {
  const fonts = fontLinks(typography).map((l) => `        ${l}`).join("\n");
  const cdn = cdnScripts.map((src) => `        <script src="${src}" async={false}></script>`).join("\n");
  return `import "./globals.css";

export const metadata = { title: "v-1.design app" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
${[fonts, cdn].filter(Boolean).join("\n")}
      </head>
      <body>{children}</body>
    </html>
  );
}
`;
};

/**
 * @param handoff  the format=json bundle
 * @param screens  the filtered screens (each gets componentName attached)
 * @param opts     { name }
 * @returns        { files: { path: contents }, routes: [{name,path}] }
 */
export function buildNextProject(handoff, screens, opts = {}) {
  const name = opts.name || handoff.appName || handoff.id || "v1design-app";
  const ds = handoff.designSystem || {};
  const typography = ds.typography || {};
  const cdnScripts = collectCdnScripts(screens);

  const files = {};
  files[".gitignore"] = GITIGNORE;
  files["package.json"] = nextPackageJson(kebab(name), opts.pm);
  files["next.config.ts"] = NEXT_CONFIG;
  files["postcss.config.mjs"] = POSTCSS_CONFIG;
  files["tsconfig.json"] = NEXT_TSCONFIG;
  files["next-env.d.ts"] = NEXT_ENV_DTS;
  files["app/globals.css"] = handoff.artifacts?.globalsCss || "@import \"tailwindcss\";\n";
  files["design-tokens.json"] = handoff.artifacts?.tokensJson || "{}";

  files["app/layout.tsx"] = handoff.artifacts?.layoutTsx
    ? patchLayout(handoff.artifacts.layoutTsx, typography, cdnScripts)
    : FALLBACK_LAYOUT(typography, cdnScripts);

  const routes = [];
  const usedSlugs = new Set();
  screens.forEach((screen, i) => {
    screen.componentName = pascal(screen.name) + "Screen";
    let slug = kebab(screen.name);
    while (usedSlugs.has(slug)) slug = `${slug}-${i}`;
    usedSlugs.add(slug);
    screen.routeSlug = slug;

    files[`components/screens/${screen.componentName}.tsx`] = transformScreenWeb(screen.code, screen);

    const importPath = `@/components/screens/${screen.componentName}`;
    if (i === 0) {
      files["app/page.tsx"] = routeFile(screen, importPath);
      routes.push({ name: screen.name, path: "/" });
    }
    files[`app/${slug}/page.tsx`] = routeFile(screen, importPath);
    routes.push({ name: screen.name, path: `/${slug}` });
  });

  files["README.md"] = nextReadme(name, handoff.id, routes);
  return { files, routes, framework: "next", runCommand: "npm run dev" };
}

function nextReadme(name, ref, routes) {
  const list = routes.map((r) => `- \`${r.path}\` — ${r.name}`).join("\n");
  return `# ${name}

Scaffolded by [v-1.design](https://v-1.design) from design \`${ref}\`.

\`\`\`bash
npm install
npm run dev
\`\`\`

## Routes
${list}

## Notes
- Design tokens live in \`app/globals.css\` (OKLCH, Tailwind v4 \`@theme\`). Every
  screen styles via \`var(--token)\`, so re-skinning means swapping these tokens.
- Keep edits on-system: see \`AGENTS.md\` for this app's design contract.
`;
}
