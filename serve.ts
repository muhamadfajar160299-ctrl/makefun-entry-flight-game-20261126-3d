// serve.ts — tiny static file server for local playtesting only.
// Serves game/ at http://localhost:8080 (or $PORT). Not part of the entry;
// the shipped game is plain static files under game/.

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "game"));
const PORT = Number(process.env.PORT ?? 8080);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const safe = normalize(join(ROOT, urlPath === "/" ? "index.html" : urlPath));
  if (!safe.startsWith(ROOT) || !existsSync(safe) || !statSync(safe).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(safe)] ?? "application/octet-stream" });
  createReadStream(safe).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Skylane Archipelago dev server: http://localhost:${PORT}/`);
});
