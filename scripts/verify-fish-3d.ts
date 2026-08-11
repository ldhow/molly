// Headless checks for the 3D fish. Runs in plain Node (no device, no GL) —
// this is the primary safety net for 3D work, since the renderer itself can
// only be judged on a device. Exits non-zero on failure. Run: yarn verify:3d
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";

import { DEFAULT_TANK_DESIGN } from "../src/shared/components/tank/tank-design";
import { serializeDesign } from "./lib/design-serialize";

import {
  createFishMesh,
  createGlbFishMesh,
  MESH_LENGTH,
} from "../src/shared/components/tank/fish-mesh-3d";
import {
  createBubbles,
  createDriftwood,
  createPlants,
  createRocks,
} from "../src/shared/components/tank/tank-decor-3d";
import {
  createBackdrop,
  createCausticsTexture,
  createParticles,
  createSand,
  createSandTexture,
} from "../src/shared/components/tank/tank-env-3d";
import { COLOR_DEFS } from "../src/shared/fish/catalog";
import { readGlbMeshGeometry } from "../src/shared/fish/glb-geometry";
import { buildSkinMap, type SkinMap } from "../src/shared/fish/skin-map";
import type { FishTraits } from "../src/shared/fish/types";

let failures = 0;

function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const PALETTE = {
  back: "#1a1c21",
  mid: "#4a4c51",
  belly: "#c9a227",
  fin: "#2a2c31",
  finRay: "#08090c",
};

// ---------------------------------------------------------------------------
// Undulation amplitude. `waveDy` is authored in SCREEN PIXELS for a ~122px 2D
// fish (~3% of its length); the 3D body is MESH_LENGTH units long. Applying it
// unscaled over-deforms the mesh by ~60x, which is what this guards.
// ---------------------------------------------------------------------------
console.log("\n-- undulation amplitude --");
{
  const fish = createFishMesh(PALETTE);
  const body = fish.group.children[0] as THREE.Mesh;
  const geo = body.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute("position");
  const rest = Float32Array.from(pos.array as ArrayLike<number>);

  let maxDx = 0;
  // Sweep a full beat at max speed so we catch the peak, not a zero crossing.
  for (let i = 0; i < 120; i++) {
    fish.update((i / 120) * Math.PI * 4, 1.3, 0.7);
    const arr = pos.array as Float32Array;
    for (let v = 0; v < arr.length; v += 3) {
      maxDx = Math.max(maxDx, Math.abs(arr[v] - rest[v]));
    }
  }
  const ratio = maxDx / MESH_LENGTH;
  check(
    "body sway stays under 10% of body length",
    ratio < 0.1,
    `max |dx| = ${maxDx.toFixed(3)} = ${(ratio * 100).toFixed(1)}% of MESH_LENGTH ${MESH_LENGTH}`,
  );

  let finite = true;
  for (const v of pos.array as Float32Array) if (!Number.isFinite(v)) finite = false;
  check("body vertices stay finite through a full beat", finite, "");
}

// ---------------------------------------------------------------------------
// Construction sanity.
// ---------------------------------------------------------------------------
console.log("\n-- construction --");
{
  const fish = createFishMesh(PALETTE);
  const body = fish.group.children[0] as THREE.Mesh;
  const geo = body.geometry as THREE.BufferGeometry;
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);

  check(
    "fish has a body plus fins and eyes",
    fish.group.children.length >= 5,
    `${fish.group.children.length} children`,
  );
  check(
    "body is longer than it is wide or tall",
    size.z > size.x && size.z > size.y,
    `x=${size.x.toFixed(2)} y=${size.y.toFixed(2)} z=${size.z.toFixed(2)}`,
  );
  check(
    "body length matches MESH_LENGTH",
    Math.abs(size.z - MESH_LENGTH) < 0.02,
    `${size.z.toFixed(3)} vs ${MESH_LENGTH}`,
  );
}

// ---------------------------------------------------------------------------
// Skin maps. The headline regression this guards: zebra's palette is all
// #ffffff and electricBlue's is all #000000, so a renderer that only reads
// `palette` draws them as a blank white and a blank black blob. Their real
// identity lives in `pattern.shapes`, which only the rasterizer picks up.
// ---------------------------------------------------------------------------
console.log("\n-- skin maps --");
{
  const quantized = (map: SkinMap) => {
    const seen = new Set<number>();
    for (let i = 0; i < map.data.length; i += 4) {
      if (map.data[i + 3] < 200) continue;
      seen.add(((map.data[i] >> 3) << 10) | ((map.data[i + 1] >> 3) << 5) | (map.data[i + 2] >> 3));
    }
    return seen.size;
  };

  const maps = new Map<string, SkinMap>();
  for (const def of COLOR_DEFS) {
    const traits: FishTraits = {
      color: def.id,
      body: "standard",
      tail: "round",
      dorsal: "standard",
      patternSeed: 0,
    };
    maps.set(def.id, buildSkinMap(traits, def));
  }

  const flat = [...maps.entries()].filter(([, m]) => quantized(m) < 6);
  check(
    "every variety renders more than a flat blob (>=6 distinct tones)",
    flat.length === 0,
    flat.length
      ? `flat: ${flat.map(([id]) => id).join(", ")}`
      : `min ${Math.min(...[...maps.values()].map(quantized))} tones`,
  );

  // Striped varieties must actually alternate along the body, not just carry
  // a couple of stray marks. Scan a band of rows and take the best: these are
  // hand-drawn, and their stripes aren't all centred on the midline
  // (caramelZebra's sit noticeably high on the flank).
  for (const id of ["zebra", "tiger", "caramelZebra"]) {
    const m = maps.get(id)!;
    let best = 0;
    for (let ry = 0.3; ry <= 0.7; ry += 0.05) {
      const row = Math.floor(m.height * ry) * m.width * 4;
      let changes = 0;
      let prev: number | null = null;
      for (let x = 0; x < m.width; x++) {
        const i = row + x * 4;
        if (m.data[i + 3] < 200) continue;
        const lum = 0.3 * m.data[i] + 0.55 * m.data[i + 1] + 0.15 * m.data[i + 2];
        const dark = lum < 128 ? 1 : 0;
        if (prev !== null && dark !== prev) changes++;
        prev = dark;
      }
      best = Math.max(best, changes);
    }
    check(`${id} has banding across the flank`, best >= 8, `${best} light/dark transitions`);
  }

  // Silhouette: transparent outside, opaque inside.
  {
    const m = maps.get("goldDust")!;
    let clear = 0;
    let solid = 0;
    for (let i = 3; i < m.data.length; i += 4) {
      if (m.data[i] < 8) clear++;
      else if (m.data[i] > 247) solid++;
    }
    const total = m.data.length / 4;
    check(
      "skin map has a real silhouette (transparent margin + opaque body)",
      clear / total > 0.15 && solid / total > 0.3,
      `${((clear / total) * 100).toFixed(0)}% clear, ${((solid / total) * 100).toFixed(0)}% opaque`,
    );
  }

  // Determinism — same traits must give identical bytes, or texture caching
  // and the preview/device comparison both become meaningless.
  {
    const def = COLOR_DEFS.find((d) => d.id === "sanke")!;
    const t: FishTraits = {
      color: "sanke",
      body: "standard",
      tail: "round",
      dorsal: "standard",
      patternSeed: 2,
    };
    const a = createHash("sha256")
      .update(Buffer.from(buildSkinMap(t, def).data))
      .digest("hex");
    const b = createHash("sha256")
      .update(Buffer.from(buildSkinMap(t, def).data))
      .digest("hex");
    check("skin maps are deterministic", a === b, a.slice(0, 12));
  }

  // Memory budget at tank capacity.
  {
    const m = maps.get("goldDust")!;
    const bytesEach = m.width * m.height * 4 * 1.34; // +mips
    const total = (bytesEach * 25) / (1024 * 1024);
    check("25 distinct skin maps fit the budget", total < 14, `${total.toFixed(1)} MB`);
  }

  // Bake TIME budget. This runs on the JS thread, one bake per frame, so a
  // slow bake is a dropped frame. Doing these inline and unbounded is what
  // froze the app: 391ms for the worst fish, ~10s for a full tank. Device
  // CPU is several times slower than CI, hence the deliberately tight cap.
  {
    let worst = 0;
    let worstId = "";
    for (const def of COLOR_DEFS) {
      // Best of two: a single sample lands on a GC pause often enough to make
      // this flaky, and what's being asserted is the cost of the work itself.
      let best = Infinity;
      for (let attempt = 0; attempt < 2; attempt++) {
        const traits: FishTraits = {
          color: def.id,
          body: "standard",
          tail: "round",
          dorsal: "standard",
          patternSeed: 5 + attempt, // never cached
        };
        const started = Date.now();
        buildSkinMap(traits, def);
        best = Math.min(best, Date.now() - started);
      }
      if (best > worst) {
        worst = best;
        worstId = def.id;
      }
    }
    check("slowest skin bake stays within one frame budget", worst < 120, `${worstId} ${worst}ms`);
  }
}

// ---------------------------------------------------------------------------
// Scene construction. No GL context here, so this proves the geometry/texture
// building and the per-frame update paths don't throw and don't drift into
// NaN — the failure mode that shows up on device as a black or frozen tank.
// ---------------------------------------------------------------------------
console.log("\n-- scene --");
{
  const finiteAttr = (o: THREE.Object3D, label: string) => {
    let ok = true;
    o.traverse((child) => {
      const g = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const pos = g?.getAttribute?.("position");
      if (!pos) return;
      for (const v of pos.array as Float32Array) if (!Number.isFinite(v)) ok = false;
    });
    check(`${label} geometry is finite`, ok, "");
  };

  const sand = createSand(16, 10);
  const plants = createPlants(9, 3, 2);
  const rocks = createRocks(6, 3, 2);
  const wood = createDriftwood(3, 2);
  const bubbles = createBubbles(14, 3, 2, 5);
  const particles = createParticles(200, 3, 2, 5);
  const backdrop = createBackdrop();

  check(
    "plants build several blades",
    plants.group.children.length >= 9,
    `${plants.group.children.length} blades`,
  );
  check("driftwood builds branches", wood.children.length >= 3, `${wood.children.length} limbs`);
  check("rocks build", rocks.children.length === 6, `${rocks.children.length}`);

  // Run the animated pieces for a simulated 10 seconds.
  for (let i = 0; i < 600; i++) {
    const t = i / 60;
    sand.update(t);
    plants.update(t, 1 / 60);
    bubbles.update(t, 1 / 60);
    particles.update(t, 1 / 60);
  }
  finiteAttr(plants.group, "plants after 10s of sway");
  finiteAttr(particles.points, "particles after 10s of drift");
  finiteAttr(sand.mesh, "sand");
  finiteAttr(backdrop, "backdrop");

  // Bubbles must stay inside the tank, not escape upward forever.
  let maxY = -Infinity;
  bubbles.group.traverse((o) => {
    maxY = Math.max(maxY, o.position.y);
  });
  check("bubbles wrap instead of escaping", maxY <= 5.05, `highest y=${maxY.toFixed(2)}`);

  // Every plant blade must carry UVs, or the leaf alpha mask can't cut the
  // silhouette and they render as rectangles.
  let uvOk = true;
  plants.group.traverse((child) => {
    const g = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g && !g.getAttribute("uv")) uvOk = false;
  });
  check("plant blades have UVs for the leaf mask", uvOk, "");
}

// ---------------------------------------------------------------------------
// Pinned geometry fingerprints.
//
// These numbers were captured from the shipped renderer BEFORE the design
// constants were extracted into tank-design.ts. Their only job is to prove
// that refactor was behaviour-preserving: if `DEFAULT_TANK_DESIGN` ever
// disagrees with what used to be hardcoded, one of these moves.
//
// They are a drift detector, not a spec. Deliberately changing the default
// design SHOULD fail here — update the expected value in the same commit,
// so the change is visible in review rather than silent.
// ---------------------------------------------------------------------------
console.log("\n-- pinned defaults (drift detector) --");
{
  const near = (actual: number, expected: number, tol: number) =>
    Math.abs(actual - expected) <= tol;

  const fish = createFishMesh(PALETTE);
  const bodyGeo = (fish.group.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry;
  bodyGeo.computeBoundingBox();
  const size = new THREE.Vector3();
  bodyGeo.boundingBox!.getSize(size);

  check(
    "fish body bbox unchanged",
    near(size.x, 0.5, 0.001) && near(size.y, 0.998, 0.002) && near(size.z, 2.0, 0.001),
    `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} (expect 0.500 x 0.998 x 2.000)`,
  );
  check(
    "fish body vertex count unchanged",
    bodyGeo.getAttribute("position").count === 392,
    `${bodyGeo.getAttribute("position").count} (expect 392 = 28 stations x 14 ring segments)`,
  );
  check(
    "fish part count unchanged",
    fish.group.children.length === 10,
    `${fish.group.children.length} (expect 10: body, tail, dorsal, 2 pelvics, anal, 2 pectorals, 2 eyes)`,
  );
  check("fish body has UVs for the skin map", !!bodyGeo.getAttribute("uv"), "");

  // The reason the lathe was replaced: a revolved profile is forced to be
  // vertically symmetric, so `backPeak` and `bellyLow` could never differ.
  // If this ever goes symmetric again, the swept body has silently regressed.
  {
    const box = bodyGeo.boundingBox!;
    const lm = DEFAULT_TANK_DESIGN.fish.shape.landmarks;
    check(
      "body back is higher than the belly is deep (asymmetric silhouette)",
      box.max.y > -box.min.y + 0.05,
      `back +${box.max.y.toFixed(3)} vs belly ${box.min.y.toFixed(3)} ` +
        `(landmarks: backPeak ${lm.backPeak.y}, bellyLow ${lm.bellyLow.y})`,
    );
    check(
      "back peak sits ahead of midbody, belly low behind the head",
      lm.backPeak.z < 0 && lm.bellyLow.z > lm.backPeak.z,
      `backPeak z=${lm.backPeak.z}, bellyLow z=${lm.bellyLow.z}`,
    );
    // Monotone interpolation exists so a landmark named `backPeak` really is
    // the highest point — an ordinary spline would overshoot past it.
    check(
      "top curve never overshoots backPeak",
      box.max.y <= lm.backPeak.y + 1e-6,
      `max y ${box.max.y.toFixed(4)} vs backPeak ${lm.backPeak.y}`,
    );
  }

  // lyretail/sailfin are real 2D trait values (render-spec.ts's tailGeom()/
  // dorsalGeom()) that a fish can already roll — this guards that the 3D
  // mesh actually renders a visibly different, larger shape for them rather
  // than silently falling back to round/standard.
  {
    const bboxSize = (mesh: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(mesh, true);
      const size = new THREE.Vector3();
      box.getSize(size);
      return size;
    };

    const round = bboxSize(fish.group.children[1]);
    const standardDorsal = bboxSize(fish.group.children[2]);

    const lyre = createFishMesh(PALETTE, { tail: "lyretail" });
    const lyreSize = bboxSize(lyre.group.children[1]);
    check(
      "lyretail renders a taller, longer-reaching tail than round",
      lyreSize.y > round.y * 1.3 && lyreSize.z > round.z * 1.1,
      `lyretail ${lyreSize.y.toFixed(2)}x${lyreSize.z.toFixed(2)} vs round ${round.y.toFixed(2)}x${round.z.toFixed(2)} (y,z)`,
    );

    const sail = createFishMesh(PALETTE, { dorsal: "sailfin" });
    const sailSize = bboxSize(sail.group.children[2]);
    check(
      "sailfin renders a taller dorsal than standard",
      sailSize.y > standardDorsal.y * 1.5,
      `sailfin ${sailSize.y.toFixed(2)} vs standard ${standardDorsal.y.toFixed(2)} (y)`,
    );

    check(
      "lyretail + sailfin still produce the same part topology",
      createFishMesh(PALETTE, { tail: "lyretail", dorsal: "sailfin" }).group.children.length === 10,
      "",
    );
  }

  // Decor is seeded, so counts and placement are deterministic.
  const plants = createPlants(9, 3, 2);
  check(
    "plant blade count unchanged for seed 1",
    plants.group.children.length === 51,
    `${plants.group.children.length} (expect 51)`,
  );

  const sand = createSand(16, 10);
  const sandGeo = (sand.mesh.geometry as THREE.BufferGeometry).getAttribute("position");
  check("sand tessellation unchanged", sandGeo.count === 49 * 25, `${sandGeo.count} (expect 1225)`);

  const backdrop = createBackdrop();
  backdrop.geometry.computeBoundingSphere();
  check(
    "backdrop radius unchanged",
    near(backdrop.geometry.boundingSphere!.radius, 40, 0.5),
    `${backdrop.geometry.boundingSphere!.radius.toFixed(1)} (expect ~40)`,
  );

  // Procedural textures: hash the bytes so any change to a noise seed,
  // frequency or colour ramp shows up immediately.
  const texHash = (t: THREE.Texture) =>
    createHash("sha256")
      .update(Buffer.from((t.image as { data: Uint8Array }).data))
      .digest("hex")
      .slice(0, 16);
  const sandHash = texHash(createSandTexture());
  const causticsHash = texHash(createCausticsTexture());
  check("sand texture bytes unchanged", sandHash === "dc85445f32c95bd4", sandHash);
  check("caustics texture bytes unchanged", causticsHash === "aa90c0d2094ae2e8", causticsHash);
}

// ---------------------------------------------------------------------------
// The imported model (assets/models/short_molly.glb) — an alternative to the
// procedural body, toggled by `fish.useGlbModel`. Separate from the pinned
// procedural checks above: this doesn't replace them, it's a drift detector
// for a second, independent geometry source.
// ---------------------------------------------------------------------------
console.log("\n-- imported glb model --");
{
  const glbPath = join(import.meta.dirname, "../assets/models/short_molly.glb");
  const bytes = readFileSync(glbPath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const parsed = readGlbMeshGeometry(arrayBuffer);
  check(
    "short_molly.glb vertex/triangle count unchanged",
    parsed.position.length / 3 === 262 && parsed.index.length / 3 === 139,
    `${parsed.position.length / 3} verts, ${parsed.index.length / 3} tris (expect 262, 139)`,
  );
  check(
    "short_molly.glb positions are finite",
    Array.from(parsed.position).every(Number.isFinite),
    "",
  );

  const started = performance.now();
  const glbFish = createGlbFishMesh(PALETTE, { bytes: arrayBuffer });
  const buildMs = performance.now() - started;
  check(
    "glb mesh build time has headroom",
    buildMs < 200,
    `${buildMs.toFixed(1)}ms (budget 200ms — the file is 43KB, this is not expected to be close)`,
  );

  const glbBody = glbFish.group.children[0] as THREE.Mesh;
  const glbGeo = glbBody.geometry as THREE.BufferGeometry;
  const uv = glbGeo.getAttribute("uv");
  let uvInRange = true;
  for (let i = 0; i < uv.array.length; i++) {
    const v = uv.array[i];
    if (!Number.isFinite(v) || v < 0 || v > 1) uvInRange = false;
  }
  check(
    "glb mesh's recomputed UVs are finite and in [0,1]",
    uvInRange,
    "replaces the source model's own unwrap regardless of its quality — see fish-mesh-3d.ts's createGlbFishMesh()",
  );

  glbGeo.computeBoundingBox();
  const glbSize = new THREE.Vector3();
  glbGeo.boundingBox!.getSize(glbSize);
  check(
    "glb mesh normalized to MESH_LENGTH",
    Math.abs(glbSize.z - MESH_LENGTH) < 0.01,
    `z span ${glbSize.z.toFixed(3)} (expect ${MESH_LENGTH})`,
  );
  // The source model is authored at an arbitrary tilt (see pcaAxes()'s header
  // comment), so its X/Y/Z aren't reliably ordered by size the way a
  // deliberately-modeled body's would be — but the RIG's remapped axes must
  // be: length (Z) longest, then height (Y), then thickness (X) thinnest.
  // Getting this wrong would mean the PCA-based orientation regressed.
  check(
    "glb mesh axes ordered length > height > thickness after remap",
    glbSize.z > glbSize.y && glbSize.y > glbSize.x,
    `x=${glbSize.x.toFixed(3)} y=${glbSize.y.toFixed(3)} z=${glbSize.z.toFixed(3)}`,
  );

  // Nose direction. `GLB_ORIENTATION`'s sign correction (fish-mesh-3d.ts) was
  // calibrated by rendering this exact file wearing goldDust — the one
  // variety whose whole identity is a black head washing back into gold — and
  // checking which end came out dark. That calibration is a hardcoded
  // constant, not something PCA re-derives, so it can't self-detect a future
  // regression (a revised model file, or a sign typo) — this check samples
  // the same goldDust cue automatically instead of relying on a screenshot
  // every time: the −Z end (nose, per `yawFor()`) must be darker than the +Z
  // end (tail).
  {
    const goldDustDef = COLOR_DEFS.find((d) => d.id === "goldDust")!;
    const goldDustTraits: FishTraits = {
      color: "goldDust",
      body: "standard",
      tail: "round",
      dorsal: "standard",
      patternSeed: 0,
    };
    const map = buildSkinMap(goldDustTraits, goldDustDef);
    const uvAttr = glbGeo.getAttribute("uv");
    const posAttr = glbGeo.getAttribute("position") as THREE.BufferAttribute;
    let noseLuma = 0;
    let noseN = 0;
    let tailLuma = 0;
    let tailN = 0;
    for (let i = 0; i < posAttr.count; i++) {
      const z = posAttr.getZ(i);
      const u = uvAttr.getX(i);
      const v = uvAttr.getY(i);
      const px = Math.min(map.width - 1, Math.max(0, Math.round(u * (map.width - 1))));
      const py = Math.min(map.height - 1, Math.max(0, Math.round(v * (map.height - 1))));
      const o = (py * map.width + px) * 4;
      if (map.data[o + 3] < 200) continue; // transparent — off the silhouette, skip
      const luma = 0.3 * map.data[o] + 0.55 * map.data[o + 1] + 0.15 * map.data[o + 2];
      if (z < -MESH_LENGTH * 0.3) {
        noseLuma += luma;
        noseN++;
      } else if (z > MESH_LENGTH * 0.3) {
        tailLuma += luma;
        tailN++;
      }
    }
    const noseAvg = noseN ? noseLuma / noseN : NaN;
    const tailAvg = tailN ? tailLuma / tailN : NaN;
    check(
      "glb mesh nose (−Z) lands on goldDust's dark head, not its gold tail",
      noseN > 0 && tailN > 0 && noseAvg < tailAvg,
      `nose luma ${noseAvg.toFixed(1)} (n=${noseN}), tail luma ${tailAvg.toFixed(1)} (n=${tailN})`,
    );
  }

  // Full beat cycle, mirroring the procedural undulation-amplitude check —
  // this mesh has no separate fins to animate, only whole-body waveDy.
  let finite = true;
  for (let f = 0; f < 240 && finite; f++) {
    glbFish.update((f / 240) * Math.PI * 2, 1, 0);
    const arr = (glbGeo.getAttribute("position") as THREE.BufferAttribute).array;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) finite = false;
    }
  }
  check("glb mesh stays finite through a full beat", finite, "");
}

// ---------------------------------------------------------------------------
// Design serialization. `yarn tank:design` overwrites tank-design.ts, so the
// serializer has to be exactly reversible — a lossy Save would silently
// corrupt the tank's look, and there'd be nothing to compare against.
// ---------------------------------------------------------------------------
console.log("\n-- design round-trip --");
{
  const source = readFileSync(
    join(import.meta.dirname, "../src/shared/components/tank/tank-design.ts"),
    "utf8",
  );

  let out = "";
  let threw = "";
  try {
    out = serializeDesign(source, DEFAULT_TANK_DESIGN);
  } catch (err) {
    threw = (err as Error).message;
  }
  check("serializer runs", !threw, threw);

  if (!threw) {
    check(
      "type definitions and comments survive a save",
      out.includes("export interface TankDesign") && out.includes("yarn tank:design"),
      "",
    );

    // Evaluate the emitted literal and compare against the input.
    const marker = "export const DEFAULT_TANK_DESIGN: TankDesign = ";
    const literal = out
      .slice(out.indexOf(marker) + marker.length)
      .trim()
      .replace(/;$/, "");
    let reparsed: unknown = null;
    let evalErr = "";
    try {
      reparsed = new Function(`return (${literal});`)();
    } catch (err) {
      evalErr = (err as Error).message;
    }
    check("emitted literal is valid JS", !evalErr, evalErr);
    check(
      "round-trip is lossless",
      JSON.stringify(reparsed) === JSON.stringify(DEFAULT_TANK_DESIGN),
      evalErr ? "" : "deep-equal to DEFAULT_TANK_DESIGN",
    );
  }

  // Refuse to write if the anchor is missing, rather than truncating the file.
  let guarded = false;
  try {
    serializeDesign("// nothing here\n", DEFAULT_TANK_DESIGN);
  } catch {
    guarded = true;
  }
  check("refuses to overwrite an unrecognised file", guarded, "");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
