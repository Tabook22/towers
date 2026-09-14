import type { CapacitorConfig } from '@capacitor/cli';

// The Android app bundles the built frontend (webDir: 'dist') rather than pointing `server.url`
// at the live site — this app is already built offline-first (a service worker app shell, an
// offline action queue, see src/offline/) so shipping the same bundled-and-cached approach here
// keeps that working even with zero signal, not just a spotty one. Build with
// `npm run build:capacitor` (bakes in .env.capacitor's VITE_API_BASE_URL) before `npx cap sync`.
const config: CapacitorConfig = {
  appId: 'io.skygreenlinelab.insulatorinspector',
  appName: 'Insulator Inspector Pro',
  webDir: 'dist',
  android: {
    // The backend is plain http:// until DEPLOY.md's HTTPS step is done — see AndroidManifest.xml's
    // usesCleartextTraffic for the other half of allowing that; drop this once it has a real
    // domain + certificate.
    allowMixedContent: true,
  },
};

export default config;
