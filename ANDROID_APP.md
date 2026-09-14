# Android app — background tracking that survives a locked screen

The website (`frontend/`) cannot keep sending GPS once a phone's screen locks, a call comes in, or
the browser is backgrounded — that's an OS-level suspension no web page can override. This wraps
the exact same React app in a thin native Android shell (via [Capacitor](https://capacitorjs.com))
with a real background-location plugin, so tracking runs as a proper Android foreground service —
survivable through all of that, at the cost of a persistent "Sharing location" notification while
it's on (Android requires that notification; it's not optional, and it's how the crew can tell
tracking is actually active).

This machine has no Android SDK/Gradle/JDK installed, so the APK is built on GitHub's own runners
instead — nothing to install locally.

## Getting an APK

1. Push to `main` (touching anything under `frontend/`) — the **Build Android APK** workflow runs
   automatically. Or trigger it by hand: repo → **Actions** → **Build Android APK** → **Run workflow**.
2. Once it finishes (a few minutes), open that run → **Artifacts** → download
   **insulator-inspector-debug-apk** → unzip it to get `app-debug.apk`.

This is a debug build (Android's own default debug signing key, not a Play Store release) — exactly
matching the "direct install, no app store" choice: sideload it, no developer account needed.

## Installing on a crew phone

1. Send `app-debug.apk` to the phone (a link, a cable, WhatsApp, whatever's easiest) and open it.
2. Android will block the first install with **"For your security, your phone is not allowed to
   install unknown apps from this source"** — tap **Settings** on that prompt, allow installs from
   whichever app the file was opened with (Files, Chrome, WhatsApp, …), then go back and install.
3. Open the app and sign in exactly as on the website. On first "Allow GPS tracking" tap, Android
   asks for location permission (allow it) and, on newer Android versions, notification permission
   (needed to show the "tracking is on" notification — allow that too).
4. **Recommended, not required:** Settings → Apps → Insulator Inspector Pro → Battery → set to
   *Unrestricted* (wording varies by phone). This app already runs a proper foreground service, so
   it doesn't strictly need this — but on the most aggressive OEM battery managers (MIUI/Xiaomi,
   Huawei, some Samsung/Oppo modes), it can still help the OS leave the tracking notification alone
   instead of trying to kill it.

## Updating the app later

Same as the website — commit, push, the **Build Android APK** workflow produces a fresh APK
automatically. There's no in-app auto-update (a plain sideloaded APK can't do that); re-download and
reinstall over the old one when there's a change the crews need (installing over an existing app
with the same package id keeps their login/local data).

## What's actually different from the website, technically

- `frontend/capacitor.config.ts` + `frontend/android/`: the native shell. `webDir: 'dist'` bundles
  the built frontend directly into the app (same offline-first approach the website already uses —
  see `frontend/src/offline/` — just carried one step further).
- `frontend/.env.capacitor`: the app's bundled JS needs an absolute backend URL baked in at build
  time (`npm run build:capacitor`), since it isn't served from the same origin as the API the way
  the website is. Update this the day the VPS gets a real domain + HTTPS — see `DEPLOY.md`.
- `@capacitor-community/background-geolocation` (a Capacitor plugin, Android-native under the
  hood): `frontend/src/hooks/useFieldTracking.tsx` uses it instead of the browser's
  `navigator.geolocation` whenever `Capacitor.isNativePlatform()` is true — everything else
  (the throttle/movement rules, the `/api/tracking/ping` endpoint, the UI status chip) is unchanged
  and shared with the website's own tracking code.
- `backend/.env`'s `CORS_ORIGINS` on the VPS includes `https://localhost` — that's the origin the
  Android app's bundled WebView requests from by default; without it the backend would reject the
  app's API calls as cross-origin.
