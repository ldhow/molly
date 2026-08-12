// Dev-only web harness for the 3D fish tank: mounts the REAL production
// components (tank-canvas-3d.tsx + fish-3d.tsx via @react-three/fiber's web
// build) fed by hand-authored mock TankFish[] data, so the actual R3F scene
// can be iterated on in a browser tab with no device, no SQLite, no Skia-web.
//
// Unlike `yarn tank:design` (a hand-rolled vanilla three.js reimplementation
// of the scene), this harness never re-derives geometry assembly — it just
// aliases the two Metro-only imports (react-native, expo-asset) and lets
// esbuild bundle the rest of the graph unmodified.
//
// The client bundle is rebuilt on every page load — refresh to pick up edits.
//
// Run: yarn tank:3d-react   (http://127.0.0.1:5479, override with PORT=)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { tank3dAlias } from "./lib/tank-3d-alias";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = Number(process.env.PORT) || 5479;

function buildClient(): string {
  const out = esbuild.buildSync({
    entryPoints: [join(here, "lib/tank-3d-react-entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    alias: tank3dAlias(root, join(here, "lib")),
  });
  return out.outputFiles[0].text;
}

function html(clientJs: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Molly 3D tank</title>
<style>
  html, body, #root { margin: 0; height: 100%; background: #04121c; }
  select { font: inherit; }
</style></head><body>
<div id="root"></div>
<script>${clientJs}</script>
</body></html>`;
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    try {
      const page = html(buildClient());
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Bundle failed:\n\n${(err as Error).message}`);
    }
    return;
  }

  if (req.method === "GET" && req.url === "/short_molly.glb") {
    try {
      const bytes = readFileSync(join(root, "assets/models/short_molly.glb"));
      res.writeHead(200, { "content-type": "model/gltf-binary" });
      res.end(bytes);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`short_molly.glb not found: ${(err as Error).message}`);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`3D tank React harness: http://127.0.0.1:${PORT}`);
});
