// Turns a rasterized skin map into a three.js texture, with a shared
// ref-counted cache and — critically — a queue so baking never blocks a frame.
//
// Rasterizing one fish costs tens of milliseconds. Doing that inline for a
// tank of 25 fish froze the app for seconds on mount. So fish render
// immediately with the cheap palette-gradient body and swap in their real
// albedo when it's ready, at most one bake per frame.
import * as THREE from "three";

import { buildSkinMap, skinMapKey, type SkinMap } from "@/shared/fish/skin-map";
import type { ColorDef, FishTraits } from "@/shared/fish/types";

export interface FishSkin {
  texture: THREE.Texture;
  /** Local-space rect the texture covers — the UV projection needs it. */
  box: SkinMap["box"];
}

type Listener = (skin: FishSkin) => void;

interface Entry {
  skin: FishSkin;
  refs: number;
}

interface Job {
  key: string;
  traits: FishTraits;
  def: ColorDef;
  listeners: Set<Listener>;
}

const cache = new Map<string, Entry>();
const queue = new Map<string, Job>();

function toTexture(map: SkinMap): THREE.Texture {
  const tex = new THREE.DataTexture(
    new Uint8Array(map.data.buffer, map.data.byteOffset, map.data.length),
    map.width,
    map.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  // DataTexture's defaults are hostile for artwork: NearestFilter and no
  // mipmaps. And because this material is built imperatively rather than
  // through R3F's JSX props, R3F's automatic sRGB tagging never runs — the
  // texture would sample washed out without setting colorSpace by hand.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // The raster buffer is written top-down, matching DataTexture's flipY=false.
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

function retain(key: string): FishSkin | null {
  const hit = cache.get(key);
  if (!hit) return null;
  hit.refs++;
  return hit.skin;
}

/**
 * Ask for a fish's skin. If it's already baked the listener fires immediately;
 * otherwise the fish is queued and the listener fires on a later frame.
 * Returns a cancel function — call it on unmount.
 */
export function requestSkin(traits: FishTraits, def: ColorDef, onReady: Listener): () => void {
  const key = skinMapKey(traits);

  const ready = retain(key);
  if (ready) {
    onReady(ready);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release(key);
    };
  }

  let job = queue.get(key);
  if (!job) {
    job = { key, traits, def, listeners: new Set() };
    queue.set(key, job);
  }
  job.listeners.add(onReady);

  let done = false;
  return () => {
    if (done) return;
    done = true;
    const pending = queue.get(key);
    if (pending?.listeners.has(onReady)) {
      pending.listeners.delete(onReady);
      // Nobody is waiting on this bake any more — drop it rather than spend a
      // frame on a fish that has already left the tank.
      if (pending.listeners.size === 0) queue.delete(key);
      return;
    }
    // The bake landed before we unmounted, so we hold a reference.
    release(key);
  };
}

/**
 * Bake at most one queued skin. Call from the scene's frame loop so the work
 * is spread across frames instead of landing in one blocking burst.
 */
export function pumpSkinQueue(): boolean {
  const next = queue.values().next();
  if (next.done) return false;
  const job = next.value;
  queue.delete(job.key);
  if (job.listeners.size === 0) return false;

  const map = buildSkinMap(job.traits, job.def);
  const skin: FishSkin = { texture: toTexture(map), box: map.box };
  cache.set(job.key, { skin, refs: 0 });
  for (const listener of job.listeners) {
    retain(job.key);
    listener(skin);
  }
  return true;
}

/**
 * Drop one fish's cached/queued skin bake so its next `requestSkin()` call
 * re-bakes from scratch instead of reusing a stale texture. `skinMapKey` is
 * keyed on traits alone, not on a `ColorDef`'s content — dev tools that
 * mutate a def's palette/pattern in place (e.g. the 3D preview in
 * `yarn fish:colors`) need this to make an edit visible; nothing in the
 * shipped app calls it.
 */
export function invalidateSkin(traits: FishTraits): void {
  const key = skinMapKey(traits);
  const hit = cache.get(key);
  if (hit) {
    hit.skin.texture.dispose();
    cache.delete(key);
  }
  queue.delete(key);
}

function release(key: string): void {
  const hit = cache.get(key);
  if (!hit) return;
  hit.refs--;
  if (hit.refs > 0) return;
  hit.skin.texture.dispose();
  cache.delete(key);
}
