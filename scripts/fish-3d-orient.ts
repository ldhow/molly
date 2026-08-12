// Orientation calibration tool for short_molly.glb: shows the raw mesh
// (freely orbit-able, no interpretation applied) next to the app's real
// createGlbFishMesh() output, with live xSign/ySign/zSign toggles — so a
// person can look at the actual geometry and dial in GLB_ORIENTATION by eye
// instead of it being inferred from a 2D projection or otherwise guessed.
//
// Run: yarn fish:3d-orient   (http://127.0.0.1:5481, override with PORT=)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { tank3dAlias } from "./lib/tank-3d-alias";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = Number(process.env.PORT) || 5481;

function buildClient(): string {
  const out = esbuild.buildSync({
    entryPoints: [join(here, "lib/fish-3d-orient-entry.tsx")],
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
<html><head><meta charset="utf-8"><title>Molly 3D fish orientation</title>
<style>
  html, body, #root { margin: 0; height: 100%; background: #04121c; }
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
  console.log(`3D fish orientation tool: http://127.0.0.1:${PORT}`);
});
