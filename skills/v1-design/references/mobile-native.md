# Mobile native basics (Expo / React Native)

Generic guidance for shipping a real native app from a v-1.design mobile design.
`v1design scaffold <ref> --surface mobile` sets this up; this file is the bar to
hold when you extend it.

## Structure
- Use **expo-router** with one file per screen under `app/` — never a single
  screen file that switches "tabs" via state. Each screen is a real route.
- A shared tab bar / navigation chrome is built **once** (e.g. `app/(tabs)/_layout.tsx`)
  and reused, not redrawn per screen.
- Wrap screen content in a SafeArea + scroll container so it respects the device
  status bar and notch. The OS draws the status bar — do not hand-draw one.

## Styling
- Colors come from one shared theme module (e.g. `lib/theme.ts`) — never inlined
  hex literals scattered across screens.
- React Native uses flexbox by default; numeric style values, not CSS unit strings.
- Load custom fonts via `expo-font`'s `useFonts` and gate render until they load,
  so text never flashes a fallback face.

## Pinning + health
- Pin the Expo SDK exactly (no caret) and declare `sdkVersion` in `app.json` so a
  reinstall can't silently drift to a different SDK.
- Verify with a type-check and `expo export` (web) at minimum:
  `npx tsc --noEmit && npx expo export --platform web`.
- Run `npx expo install --check` (or expo-doctor) — any version mismatch is a fail.
- A screen that renders a screenshot image instead of native UI is NOT a real
  screen; rebuild it with native primitives.

## Verify
- `v1design verify <dir>` runs the build/export gate. For the visual verdict, run
  the app on a simulator/device (or the web export), screenshot each screen, and
  `v1design grade <dir>`. Hold the same bar as web.
