// Driver for `scripts/blender/plant.py` — renders every entry in
// `scene/sprites/blender-manifest.ts` and drops the PNGs where that manifest
// says they live.
//
// A driver is necessary rather than a loop inside the Python because each
// `blender --python` invocation is one process and one scene; Blender has no
// notion of "render these five unrelated pieces". Keeping the loop out here
// also means a single failing species does not take the batch down with it.
//
// Blender is NOT a repo dependency and never will be. It is a build-time art
// tool: the PNGs it produces are what ship, and nothing in `src/` imports
// anything from it. So this script must be skippable — if Blender is absent
// it says so and exits 0 rather than failing anyone's `npm run verify`.
//
//   yarn decor:blender                  # every species, default seed
//   yarn decor:blender -- --seed 7      # a different roll
//   yarn decor:blender -- --res 1024x1280 --samples 128    # ship quality
//
// The renders are deterministic in the seed, so re-running with the same
// arguments reproduces the same art.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { BLENDER_PIECES } from "@/shared/aquarium/scene/sprites/blender-manifest";

const REPO = path.join(__dirname, "..");
const SCRIPT = path.join(__dirname, "blender", "plant.py");

/** Where to look for Blender, in order. `BLENDER` wins so CI can point anywhere. */
const CANDIDATES = [
  process.env.BLENDER,
  "D:/Blender/blender.exe",
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
  "/Applications/Blender.app/Contents/MacOS/Blender",
  "blender",
].filter((x): x is string => Boolean(x));

function findBlender(): string | null {
  for (const candidate of CANDIDATES) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    // Bare name — let the OS resolve it, and treat a non-zero exit as absent.
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

interface Args {
  /** null = render each manifest entry at the seed baked into its own filename. */
  seed: number | null;
  res: string | null;
  samples: number;
  only: string | null;
}

function parseArgs(argv: string[]): Args {
  // res null = use each piece's own `renderRes`; --res overrides all of them.
  const out: Args = { seed: null, res: null, samples: 48, only: null };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--seed" && next) out.seed = Number(next);
    else if (argv[i] === "--res" && next) out.res = next;
    else if (argv[i] === "--samples" && next) out.samples = Number(next);
    else if (argv[i] === "--only" && next) out.only = next;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const blender = findBlender();
  if (!blender) {
    console.log(
      "Blender not found — skipping decor renders.\n" +
        "  Set BLENDER=/path/to/blender, or install Blender 5.x.\n" +
        `  Tried: ${CANDIDATES.join(", ")}`,
    );
    return;
  }
  console.log(`Using ${blender}`);

  // One species may back several manifest entries (different seeds); render
  // whatever each entry's own `file` path asks for rather than assuming a
  // one-to-one mapping.
  const jobs = Object.entries(BLENDER_PIECES)
    .map(([id, piece]) => {
      const base = path.basename(piece.file, ".png");
      const [species, seedText] = base.split("-");
      return {
        id,
        piece,
        species,
        seed: args.seed ?? Number(seedText),
        res: args.res ?? piece.renderRes,
        out: path.join(REPO, piece.file),
      };
    })
    .filter((j) => !args.only || j.species === args.only);

  if (jobs.length === 0) {
    console.log(`No pieces matched --only ${args.only}`);
    return;
  }

  let failed = 0;
  for (const job of jobs) {
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    const passes = ["beauty", job.piece.normal ? "normal" : null, job.piece.depth ? "depth" : null]
      .filter(Boolean)
      .join(",");

    process.stdout.write(`  ${job.id} (${job.species}) ... `);
    const started = Date.now();
    const run = spawnSync(
      blender,
      [
        "--background",
        "--factory-startup",
        "--python",
        SCRIPT,
        "--",
        "--species",
        job.species,
        "--out",
        job.out,
        "--seed",
        String(job.seed),
        "--samples",
        String(args.samples),
        "--res",
        job.res,
        "--passes",
        passes,
      ],
      { encoding: "utf8" },
    );

    const wrote = (run.stdout ?? "").split("\n").filter((l) => l.startsWith("WROTE")).length;
    if (run.status !== 0 || wrote === 0) {
      failed++;
      console.log("FAILED");
      // Blender's own traceback is the only useful diagnostic here, and it
      // goes to stdout, not stderr.
      const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-12);
      console.log(tail.map((l) => `      ${l}`).join("\n"));
      continue;
    }
    console.log(`${wrote} pass(es), ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  console.log(
    failed === 0
      ? `Rendered ${jobs.length} piece(s) into assets/images/scene3d/`
      : `Rendered ${jobs.length - failed} of ${jobs.length}; ${failed} failed`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
