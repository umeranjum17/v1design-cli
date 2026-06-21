// Conservative web-TSX → React Native transpile. The studio mobile screens are
// web React (div/span/svg + inline style objects using var()/web units). We map
// the JSX tags to RN / react-native-svg primitives and route every inline style
// through a runtime adapter (lib/webstyle.ts) that resolves var() tokens and web
// units at render time. This yields a genuinely native, runnable screen — not a
// screenshot. (The engine `rnCode` artifact, when present, is preferred over this.)

const TAG_MAP = {
  div: "View", section: "View", header: "View", footer: "View", nav: "View",
  main: "View", article: "View", aside: "View", ul: "View", ol: "View",
  li: "View", figure: "View", figcaption: "View", button: "Pressable",
  span: "Text", p: "Text", h1: "Text", h2: "Text", h3: "Text", h4: "Text",
  h5: "Text", h6: "Text", em: "Text", strong: "Text", label: "Text", small: "Text",
  a: "Text", img: "Image",
};

const SVG_TAGS = new Set([
  "svg", "path", "circle", "rect", "g", "line", "polyline", "polygon",
  "ellipse", "defs", "lineargradient", "radialgradient", "stop", "clippath", "text", "tspan",
]);
const SVG_CAP = {
  svg: "Svg", path: "Path", circle: "Circle", rect: "Rect", g: "G", line: "Line",
  polyline: "Polyline", polygon: "Polygon", ellipse: "Ellipse", defs: "Defs",
  lineargradient: "LinearGradient", radialgradient: "RadialGradient", stop: "Stop",
  clippath: "ClipPath", text: "SvgText", tspan: "TSpan",
};

/** Rewrite a single opening/closing tag name. */
function mapTag(tag) {
  const lower = tag.toLowerCase();
  if (SVG_TAGS.has(lower)) return SVG_CAP[lower];
  return TAG_MAP[lower] || null;
}

/**
 * Transpile screen code into an RN component file.
 * Returns { code, usesSvg } or null if the code can't be safely transpiled.
 */
export function transpileScreenRN(srcCode, componentName) {
  let code = String(srcCode || "");
  if (!code.trim()) return null;

  // Strip the studio's injected <style>…</style> blocks (web-only CSS).
  code = code.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

  let usesSvg = false;
  const usedRn = new Set(["View", "Text"]);

  // Replace JSX tags. We only touch lowercase intrinsic tags (web elements).
  code = code.replace(/<\/?([a-z][a-zA-Z0-9]*)([\s/>])/g, (m, tag, tail) => {
    const mapped = mapTag(tag);
    if (!mapped) return m; // leave components / unknown tags
    if (SVG_TAGS.has(tag.toLowerCase())) usesSvg = true;
    else usedRn.add(mapped);
    const slash = m.startsWith("</") ? "</" : "<";
    return `${slash}${mapped}${tail}`;
  });

  // style={{…}} → style={ws({…})}  (runtime adapter resolves tokens/units)
  code = code.replace(/style=\{\{/g, "style={ws({");
  code = code.replace(/style=\{ws\(\{([\s\S]*?)\}\}/g, (m, body) => `style={ws({${body}})}`);

  // className on RN primitives is harmless with NativeWind but token classes
  // won't resolve without config; drop className to avoid confusion.
  code = code.replace(/\s+className=("[^"]*"|\{[^}]*\})/g, "");

  // <img src=…> → <Image source={{ uri: … }} />  (best-effort)
  code = code.replace(/<Image([^>]*?)\ssrc=(("[^"]*")|\{[^}]*\})([^>]*?)\/?>/g,
    (m, pre, src, _q, post) => `<Image${pre} source={{ uri: ${src.startsWith("{") ? src.slice(1, -1) : src} }}${post} />`);

  // Build the import header.
  const rnImports = [...usedRn].sort().join(", ");
  const header = [
    `import React from "react";`,
    `import { ${rnImports} } from "react-native";`,
    usesSvg ? `import Svg, { Path, Circle, Rect, G, Line, Polyline, Polygon, Ellipse, Defs, LinearGradient, RadialGradient, Stop, ClipPath, Text as SvgText, TSpan } from "react-native-svg";` : "",
    `import { ws } from "@/lib/webstyle";`,
    `import { ScreenScaffold } from "@/components/ScreenScaffold";`,
  ].filter(Boolean).join("\n");

  // Drop the original `import React …` line (we add our own) and any web imports.
  code = code.replace(/^\s*import\s+React[^\n]*\n/, "");
  code = code.replace(/^\s*import\s+["'][^"']+\.css["'];?\n/gm, "");

  // Rename the default export to the route component name; wrap its body so the
  // outer node sits inside the shared native scaffold (SafeArea + scroll).
  code = code.replace(/export default function\s+Screen\b/, `function ${componentName}Body`);
  code = code.replace(/export default function\s+(\w+)/, `function ${componentName}Body`);

  const wrapper = `

export default function ${componentName}() {
  return (
    <ScreenScaffold>
      <${componentName}Body />
    </ScreenScaffold>
  );
}
`;

  return { code: `${header}\n${code}\n${wrapper}`, usesSvg };
}
