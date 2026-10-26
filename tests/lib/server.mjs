// Serves whm-site/ the way the browser sees it in production, with a few
// swaps so no real Supabase (or network) is needed:
//
//   /js/supabase-init.js  → fixtures/mock-supabase.js (Realtime faked over
//                           BroadcastChannel, tables from window.__db)
//   /config.js            → a mock config (tests can still page.route() it)
//   /hangout.html         → just the cozy room, cut from the real index.html,
//                           plus fixtures/hangout-driver.js
//   /__fixtures__/*       → tests/fixtures/*
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");
export const SITE = path.join(HERE, "..", "..", "whm-site");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
               ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
               ".webmanifest": "application/manifest+json" };

const MOCK_CONFIG = "window.WHM_CONFIG = " + JSON.stringify({
  supabase: { url: "https://mock.supabase.co", anonKey: "mock" },
  webrtc: { iceServers: [] },
}) + ";";

// The cozy room on its own, so tests drive openHangout() directly instead of
// signing in. Built from index.html on every request, so it never drifts.
function hangoutPage() {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const head = html.match(/<head>[\s\S]*?<\/head>/)[0];
  const room = html.match(/<section id="screen-hangout"[\s\S]*?<\/section>/)[0].replace(/^(<section[^>]*?)\s+hidden/, "$1");
  return `<!DOCTYPE html><html lang="en">${head}<body><main class="wrap">${room}</main>` +
    `<script type="module" src="/__fixtures__/hangout-driver.js"></script></body></html>`;
}

export function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const send = (type, body) => { res.writeHead(200, { "Content-Type": type }); res.end(body); };
    if (url === "/config.js") return send(MIME[".js"], MOCK_CONFIG);
    if (url === "/hangout.html") return send(MIME[".html"], hangoutPage());
    const file = url === "/js/supabase-init.js" ? path.join(FIXTURES, "mock-supabase.js")
      : url.startsWith("/__fixtures__/") ? path.join(FIXTURES, url.slice("/__fixtures__/".length))
      : path.join(SITE, url);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      send(MIME[path.extname(file)] || "application/octet-stream", buf);
    });
  }).listen(0);
  return { server, origin: `http://localhost:${server.address().port}` };
}
