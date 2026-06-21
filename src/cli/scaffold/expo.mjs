// Build a runnable Expo (SDK pinned) app from a v-1.design mobile handoff:
// expo-router routes (one per screen, not tab-state), NativeWind, a hex theme
// baked from the OKLCH tokens, fonts via expo-font, and one shared Tabs chrome.
// Screens are transpiled to real RN primitives (never a screenshot).
import { kebab, pascal, apiRequest } from "../lib/engine.mjs";
import {
  GITIGNORE, expoPackageJson, expoAppJson, EXPO_BABEL, EXPO_METRO,
  expoTailwindConfig, EXPO_TSCONFIG, EXPO_NATIVEWIND_DTS, EXPO_SDK,
} from "./templates.mjs";
import { semanticToHex } from "./color.mjs";
import { transpileScreenRN } from "./rn-transpile.mjs";

// Google-Fonts family → @expo-google-fonts package name.
function expoFontPkg(family) {
  if (!family) return null;
  const slug = String(family).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `@expo-google-fonts/${slug}`;
}
function fontExportName(family) {
  return String(family || "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildTheme(handoff) {
  const ds = handoff.designSystem || {};
  const mode = handoff.mode === "light" ? "light" : "dark";
  const sem = ds.semantic?.[mode] || ds.semantic?.dark || ds.semantic?.light || {};
  const hex = semanticToHex(sem);
  const typo = ds.typography || {};
  return { mode, hex, typography: typo };
}

function themeTs(theme, fontFamilies) {
  const colorEntries = Object.entries(theme.hex)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  return `// Design tokens for this app (baked to hex from v-1.design OKLCH tokens).
export const colors = {
${colorEntries}
} as const;

export const fonts = {
  display: ${JSON.stringify(fontFamilies.display || "System")},
  body: ${JSON.stringify(fontFamilies.body || "System")},
};

export const mode = ${JSON.stringify(theme.mode)};
export type ColorToken = keyof typeof colors;
`;
}

// Runtime adapter: resolves web inline-style objects (var() tokens, web unit
// strings) into RN-safe style. Generated per-project so it knows the tokens.
function webstyleTs(theme, fontFamilies) {
  const cssVarMap = {
    "--background": theme.hex.background,
    "--foreground": theme.hex.foreground,
    "--card": theme.hex.card,
    "--card-foreground": theme.hex.cardForeground,
    "--primary": theme.hex.primary,
    "--primary-foreground": theme.hex.primaryForeground,
    "--secondary": theme.hex.secondary,
    "--secondary-foreground": theme.hex.secondaryForeground,
    "--accent": theme.hex.accent,
    "--accent-foreground": theme.hex.accentForeground,
    "--muted": theme.hex.muted,
    "--muted-foreground": theme.hex.mutedForeground,
    "--border": theme.hex.border,
    "--ring": theme.hex.ring,
    "--destructive": theme.hex.destructive,
    "--font-sans": fontFamilies.body || "System",
    "--font-display": fontFamilies.display || "System",
    "--font-mono": "System",
  };
  const varEntries = Object.entries(cssVarMap)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  return `// Runtime web-style → React Native style adapter.
// Resolves var(--token) and strips web units so studio inline styles render natively.
const VARS: Record<string, string> = {
${varEntries}
};

const DROP = new Set(["cursor", "userSelect", "pointerEvents", "boxSizing", "appearance", "outline", "transition", "willChange", "backdropFilter", "WebkitBackdropFilter", "filter", "mixBlendMode", "WebkitBackgroundClip", "backgroundClip"]);

function resolveColor(v: string): string {
  const m = v.match(/var\\(\\s*(--[a-z-]+)\\s*(?:,\\s*([^)]+))?\\)/i);
  if (m) return VARS[m[1]] ?? (m[2] ? resolveColor(m[2].trim()) : "transparent");
  return v;
}

function toNum(v: string): number | string {
  const m = String(v).match(/^(-?[\\d.]+)(px|rem|em|pt)?$/);
  if (!m) return v;
  const n = parseFloat(m[1]);
  if (m[2] === "rem" || m[2] === "em") return n * 16;
  return n;
}

export function ws(style: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key in style) {
    if (DROP.has(key)) continue;
    let val = style[key];
    if (typeof val === "string" && val.includes("var(")) val = resolveColor(val);
    if (key === "display" && val === "flex") continue; // RN default
    if (key === "fontFamily" && typeof val === "string") { out[key] = resolveColor(val); continue; }
    if (typeof val === "string" && /^(padding|margin)$/.test(key)) {
      // expand shorthand "a b c d" into per-side props
      const parts = val.trim().split(/\\s+/).map(toNum);
      const [t, r = t, b = t, l = r] = parts as any[];
      const cap = key === "padding" ? "padding" : "margin";
      out[cap + "Top"] = t; out[cap + "Right"] = r; out[cap + "Bottom"] = b; out[cap + "Left"] = l;
      continue;
    }
    if (typeof val === "string" && /(width|height|top|left|right|bottom|gap|fontSize|borderRadius|lineHeight|letterSpacing|flexBasis|maxWidth|minWidth|maxHeight|minHeight|borderWidth)/i.test(key)) {
      out[key] = toNum(val);
      continue;
    }
    out[key] = val;
  }
  return out;
}
`;
}

function screenScaffold(theme) {
  return `import React from "react";
import { ScrollView, View, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/lib/theme";

// Shared native chrome wrapper for every screen: SafeArea + scroll + status bar.
export function ScreenScaffold({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <StatusBar barStyle={${JSON.stringify(theme.mode === "light" ? "dark-content" : "light-content")}} />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
`;
}

function rootLayout(fontFamilies, fontPkgs) {
  // Load all families via a single useFonts call.
  const fontMap = fontPkgs
    .map((p) => {
      // @expo-google-fonts/<slug> exports <FamilyName>_400Regular (PascalCase family).
      const exportName = fontExportName(fontFamilies.byPkg[p]);
      return `    "${fontFamilies.byPkg[p]}": require("${p}").${exportName}_400Regular,`;
    })
    .join("\n");
  return `import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
${fontMap}
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
`;
}

function tabsLayout(screens, theme) {
  const tabs = screens
    .map((s) => `      <Tabs.Screen name=${JSON.stringify(s.routeSlug)} options={{ title: ${JSON.stringify(s.name)} }} />`)
    .join("\n");
  return `import React from "react";
import { Tabs } from "expo-router";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent ?? colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
${tabs}
    </Tabs>
  );
}
`;
}

export async function buildExpoProject(handoff, screens, opts = {}) {
  const name = opts.name || handoff.appName || handoff.id || "v1design-app";
  const slug = kebab(name);
  const theme = buildTheme(handoff);

  // Prefer the engine's true-native RN compile (LLM rewrite → real RN). Falls back
  // to the local transpile per-screen if the endpoint or a given screen fails.
  let rnMap = null;
  if (!opts.referenceOnly) {
    try {
      const res = await apiRequest("POST", `/designs/${encodeURIComponent(handoff.id)}/rn`, { body: {} });
      rnMap = { themeTs: res?.themeTs || null, byName: {} };
      for (const s of res?.screens || []) if (s.rnCode) rnMap.byName[String(s.name).toLowerCase()] = s.rnCode;
    } catch {
      rnMap = null; // network/access failure → local transpile
    }
  }

  const families = {
    display: theme.typography.fontDisplay,
    body: theme.typography.fontBody,
  };
  const pkgList = [];
  const byPkg = {};
  for (const fam of [families.display, families.body]) {
    const pkg = expoFontPkg(fam);
    if (pkg && !pkgList.includes(pkg)) { pkgList.push(pkg); byPkg[pkg] = fam; }
  }

  const files = {};
  files[".gitignore"] = GITIGNORE;
  files["package.json"] = expoPackageJson(slug, pkgList);
  files["app.json"] = expoAppJson(name, slug, EXPO_SDK);
  files["babel.config.js"] = EXPO_BABEL;
  files["metro.config.js"] = EXPO_METRO;
  files["tailwind.config.js"] = expoTailwindConfig();
  files["tsconfig.json"] = EXPO_TSCONFIG;
  files["nativewind-env.d.ts"] = EXPO_NATIVEWIND_DTS;
  files["global.css"] = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`;
  files["lib/theme.ts"] = rnMap?.themeTs || themeTs(theme, families);
  files["lib/webstyle.ts"] = webstyleTs(theme, families);
  files["components/ScreenScaffold.tsx"] = screenScaffold(theme);
  files["design-tokens.json"] = handoff.artifacts?.tokensJson || "{}";

  // Routes: app/_layout (fonts) → app/(tabs)/_layout (tabs) → one file per screen.
  const usedSlugs = new Set();
  const routes = [];
  screens.forEach((s, i) => {
    s.componentName = pascal(s.name);
    let rslug = kebab(s.name);
    while (usedSlugs.has(rslug)) rslug = `${rslug}-${i}`;
    usedSlugs.add(rslug);
    s.routeSlug = rslug;

    const engineRn = rnMap?.byName?.[String(s.name).toLowerCase()];
    if (engineRn) {
      // True-native: the engine's RN rewrite is self-contained — use it directly.
      files[`components/screens/${s.componentName}.tsx`] = engineRn.includes("export default") ? engineRn : `${engineRn}\nexport default ${s.componentName};\n`;
      files[`app/(tabs)/${rslug}.tsx`] = `import ${s.componentName} from "@/components/screens/${s.componentName}";\nexport default ${s.componentName};\n`;
    } else if (!opts.referenceOnly && transpileScreenRN(s.code, s.componentName)) {
      // Fallback: local best-effort transpile.
      files[`components/screens/${s.componentName}.tsx`] = transpileScreenRN(s.code, s.componentName).code;
      files[`app/(tabs)/${rslug}.tsx`] = `import ${s.componentName} from "@/components/screens/${s.componentName}";\nexport default ${s.componentName};\n`;
    } else {
      // Honest reference fallback (only when transpile impossible or --reference-only).
      files[`app/(tabs)/${rslug}.tsx`] = referenceScreen(s);
    }
    routes.push({ name: s.name, path: `/${rslug}` });
  });

  files["app/_layout.tsx"] = rootLayout({ ...families, byPkg }, pkgList);
  files["app/(tabs)/_layout.tsx"] = tabsLayout(screens, theme);
  files["app/index.tsx"] = `import { Redirect } from "expo-router";\nexport default function Index() {\n  return <Redirect href=${JSON.stringify(`/(tabs)/${screens[0].routeSlug}`)} />;\n}\n`;
  files["README.md"] = expoReadme(name, handoff.id, routes);

  return { files, routes, framework: "expo", runCommand: "npx expo start" };
}

function referenceScreen(screen) {
  return `import React from "react";
import { Image, ScrollView } from "react-native";
import { ScreenScaffold } from "@/components/ScreenScaffold";

// Reference render of "${screen.name}". Rebuild natively with the design tokens.
export default function ${screen.componentName || "Screen"}() {
  return (
    <ScreenScaffold>
      <ScrollView>
        <Image
          source={{ uri: ${JSON.stringify(screen.screenshotUrl || "")} }}
          style={{ width: "100%", aspectRatio: 402 / 874 }}
          resizeMode="cover"
        />
      </ScrollView>
    </ScreenScaffold>
  );
}
`;
}

function expoReadme(name, ref, routes) {
  const list = routes.map((r) => `- \`${r.path}\` — ${r.name}`).join("\n");
  return `# ${name}

Expo (SDK ${EXPO_SDK}) app scaffolded by [v-1.design](https://v-1.design) from \`${ref}\`.

\`\`\`bash
npm install
npx expo start
\`\`\`

## Routes (expo-router)
${list}

## Notes
- Colors live in \`lib/theme.ts\` (baked to hex from the design's OKLCH tokens).
- Screens are transpiled to React Native primitives via \`lib/webstyle.ts\`.
- Keep edits on-system — see \`AGENTS.md\`.
`;
}
