// Static, known-good project templates for scaffolding. Hand-written so a
// scaffold needs no `create-next-app`/`create-expo` round-trip and is pinned.

export const GITIGNORE = `node_modules
.next
dist
.expo
.expo-shared
*.log
.DS_Store
.env*.local
`;

// ── Next.js (App Router + Tailwind v4 + TS) ───────────────────────────────
export function nextPackageJson(name, pm = "npm") {
  return JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "next lint",
      },
      dependencies: {
        next: "15.5.4",
        react: "19.1.1",
        "react-dom": "19.1.1",
      },
      devDependencies: {
        typescript: "5.9.2",
        "@types/node": "24.3.0",
        "@types/react": "19.1.12",
        "@types/react-dom": "19.1.9",
        tailwindcss: "4.1.13",
        "@tailwindcss/postcss": "4.1.13",
        "tw-animate-css": "1.4.0",
      },
    },
    null,
    2
  ) + "\n";
}

export const NEXT_CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // v-1.design references images from common CDNs; allow remote images.
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Screen components are generated design art (loosely typed); don't let strict
  // type/lint checks block production builds. Your editor still type-checks.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
`;

export const POSTCSS_CONFIG = `const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
`;

export const NEXT_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
      plugins: [{ name: "next" }],
      paths: { "@/*": ["./*"] },
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  },
  null,
  2
) + "\n";

export const NEXT_ENV_DTS = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`;

// ── Expo (SDK pinned, expo-router + NativeWind v4 + TS) ────────────────────
export const EXPO_SDK = "52.0.0";

export function expoPackageJson(name, fontPkgs = []) {
  const fontDeps = {};
  for (const pkg of fontPkgs) fontDeps[pkg] = "^0.2.3";
  return JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      main: "expo-router/entry",
      scripts: {
        start: "expo start",
        android: "expo start --android",
        ios: "expo start --ios",
        web: "expo start --web",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        expo: EXPO_SDK,
        "expo-router": "4.0.21",
        "expo-asset": "11.0.5",
        "expo-constants": "17.0.8",
        "expo-linking": "7.0.5",
        "expo-font": "13.0.4",
        "expo-splash-screen": "0.29.24",
        "expo-status-bar": "2.0.1",
        react: "18.3.1",
        "react-dom": "18.3.1",
        "react-native": "0.76.9",
        "react-native-safe-area-context": "4.12.0",
        "react-native-screens": "4.4.0",
        "react-native-svg": "15.8.0",
        "react-native-web": "0.19.13",
        nativewind: "4.1.23",
        "react-native-reanimated": "3.16.7",
        ...fontDeps,
      },
      devDependencies: {
        "@babel/core": "7.26.0",
        "@types/react": "18.3.12",
        typescript: "5.9.2",
        tailwindcss: "3.4.17",
      },
    },
    null,
    2
  ) + "\n";
}

export function expoAppJson(name, slug, sdkVersion = EXPO_SDK) {
  return JSON.stringify(
    {
      expo: {
        name,
        slug,
        sdkVersion,
        version: "1.0.0",
        orientation: "portrait",
        scheme: slug,
        userInterfaceStyle: "automatic",
        newArchEnabled: true,
        web: { bundler: "metro", output: "static" },
        plugins: ["expo-router", "expo-font"],
        experiments: { typedRoutes: true },
      },
    },
    null,
    2
  ) + "\n";
}

export const EXPO_BABEL = `module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
`;

export const EXPO_METRO = `const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
`;

export function expoTailwindConfig() {
  return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
`;
}

export const EXPO_TSCONFIG = JSON.stringify(
  {
    extends: "expo/tsconfig.base",
    compilerOptions: {
      strict: true,
      paths: { "@/*": ["./*"] },
    },
    include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  },
  null,
  2
) + "\n";

export const EXPO_NATIVEWIND_DTS = `/// <reference types="nativewind/types" />
`;
