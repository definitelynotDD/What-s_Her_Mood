import { chromium } from "playwright";

// Fake camera/mic/screen so calls work headless. The full Chromium build
// ("chromium" channel) is used rather than the stripped headless shell, which
// lacks screen capture. Set CHROMIUM_PATH to use a specific browser binary.
export const MEDIA_ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];

const which = () => process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" };

export function launch(args = []) {
  return chromium.launch({ headless: true, args, ...which() });
}

// A browser with a real (non-incognito) profile in `dir` — e.g. Chrome won't
// call any site installable in incognito, which is what launch() contexts are.
export function launchProfile(dir, opts = {}) {
  return chromium.launchPersistentContext(dir, { headless: true, ...which(), ...opts });
}

// A signed-in, paired couple ("dev" + "ana") for the mock database.
export const PAIRED_DB = () => {
  window.__user = { id: "me" };
  window.__db = {
    users: [{ id: "me", display_name: "dev", role: "partner", paired_with: "her", pairing_code: "ABC234" },
            { id: "her", display_name: "ana", role: "her", paired_with: "me", pairing_code: "XYZ789" }],
    todos: [], cycle_settings: [{ user_id: "her", cycle_length: 28, period_length: 5 }], period_starts: [],
  };
};

// Serve a config with these celebrations instead of the default mock config.
export const configWith = (celebrations) => (route) => route.fulfill({ contentType: "text/javascript", body:
  "window.WHM_CONFIG = " + JSON.stringify({ supabase: { url: "https://mock.supabase.co", anonKey: "mock" }, webrtc: { iceServers: [] }, celebrations }) + ";" });

export function checker() {
  let failed = 0;
  const check = (name, ok, info) => {
    console.log((ok ? "PASS " : "FAIL ") + name + (info && !ok ? "  " + JSON.stringify(info) : ""));
    if (!ok) failed++;
  };
  const done = () => { console.log(failed ? failed + " FAILED" : "ALL PASSED"); process.exit(failed ? 1 : 0); };
  return { check, done };
}
