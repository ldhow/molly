"use no memo"; // Reads a mutable module-level cache during render, and relies
// on a state bump to re-read it — the same reason `fish-layer.tsx` carries
// this pragma. React Compiler cannot see that `peekBakedSource(key)` returns
// something different after the scheduler fills the cache, so letting it
// memoise that read on `key` alone would freeze every tile at its initial
// (empty) value.

import { useEffect, useState } from "react";

import { peekBakedSource, type BakedImageSource } from "./baked-uri";

/**
 * Producing one preview means rasterising ~100 IR nodes into an offscreen
 * Skia surface and then PNG-encoding the result. That is affordable once, and
 * ruinous when a grid does it for every tile inside a single synchronous
 * render pass — which is exactly what an un-virtualized screen full of fish
 * asks for. Under ~8ms of work per frame keeps the JS thread responsive
 * (a 60fps frame is ~16ms) while the grid fills in over the next few frames.
 */
const SLICE_MS = 8;

const queue: (() => void)[] = [];
let draining = false;

function drain() {
  const start = Date.now();
  while (queue.length > 0 && Date.now() - start < SLICE_MS) {
    queue.shift()?.();
  }
  if (queue.length > 0) {
    requestAnimationFrame(drain);
  } else {
    draining = false;
  }
}

function schedule(job: () => void) {
  queue.push(job);
  if (draining) return;
  draining = true;
  requestAnimationFrame(drain);
}

/**
 * Returns the encoded preview for `key`, or `null` until it has been produced.
 *
 * A cache hit is returned on the FIRST render with no work at all, so a
 * screen revisited during the same session paints its art immediately; only a
 * genuine miss is deferred. Callers render a correctly-sized empty box while
 * this is null, so tiles never reflow as art arrives — they just fill in.
 *
 * `produce` is expected to populate the shared cache in `baked-uri.ts` as a
 * side effect (that is what `getCachedFishSource` and friends do); its return
 * value is ignored, and duplicate jobs for one key are near-free because the
 * second one is a cache hit inside `bakedImageSource`.
 */
export function useBakedSource(key: string, produce: () => unknown): BakedImageSource | null {
  const [, bump] = useState(0);
  const cached = peekBakedSource(key);

  useEffect(() => {
    if (peekBakedSource(key)) return;
    let cancelled = false;
    schedule(() => {
      if (cancelled) return;
      produce();
      bump((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // `produce` is deliberately NOT a dependency. `key` identifies the art
    // completely, so every `produce` closure built for a given key does the
    // same work — a stale one is not a wrong one. Depending on it would
    // re-queue a job on every single re-render, since callers pass a fresh
    // arrow each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return cached;
}
