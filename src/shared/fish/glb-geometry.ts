// A dependency-free reader for one mesh's geometry out of a glTF-binary
// (.glb) file — deliberately NOT three.js's GLTFLoader.
//
// GLTFLoader is built for arbitrary scenes: materials, textures, skins,
// animations, multi-node graphs. We only ever want one mesh's raw vertex
// positions and triangle indices — everything else about a source .glb
// (its own UVs, its own placeholder texture) gets discarded and replaced by
// this app's own skin-texture pipeline (see fish-mesh-3d.ts's
// `createGlbFishMesh`). Pulling in the full loader for that 10% would also
// break outside a browser: its texture path decodes images via `document`/
// `Image`, which don't exist under plain Node (this file is read by
// verify-fish-3d.ts via tsx, no DOM).
//
// This module touches only ArrayBuffer/DataView/TextDecoder — no Buffer, no
// fetch, no DOM — so the exact same code runs in Node (verify-fish-3d.ts),
// the browser preview tools (tank-studio.ts, fish-3d-driver.ts), and the
// Expo app (fed bytes from expo-asset).

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT2" | "MAT3" | "MAT4";
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfJson {
  meshes: {
    primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[];
  }[];
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
}

const TYPE_COMPONENTS: Record<GltfAccessor["type"], number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/** [byte size, DataView getter name] per glTF componentType code. */
const COMPONENT_READERS: Record<number, [size: number, get: keyof DataView]> = {
  5120: [1, "getInt8"],
  5121: [1, "getUint8"],
  5122: [2, "getInt16"],
  5123: [2, "getUint16"],
  5125: [4, "getUint32"],
  5126: [4, "getFloat32"],
};

/** Read one accessor into a flat number array, honouring bufferView byteStride. */
function readAccessor(json: GltfJson, bin: DataView, accessorIndex: number): Float64Array {
  const accessor = json.accessors[accessorIndex];
  const numComponents = TYPE_COMPONENTS[accessor.type];
  const reader = COMPONENT_READERS[accessor.componentType];
  if (!reader) throw new Error(`Unsupported glTF componentType: ${accessor.componentType}`);
  const [size, getterName] = reader;

  const out = new Float64Array(accessor.count * numComponents);
  if (accessor.bufferView === undefined) return out; // sparse/zero-filled accessor

  const bufferView = json.bufferViews[accessor.bufferView];
  const elementStride = bufferView.byteStride ?? size * numComponents;
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

  for (let i = 0; i < accessor.count; i++) {
    const elementStart = base + i * elementStride;
    for (let c = 0; c < numComponents; c++) {
      const getter = bin[getterName] as (offset: number, littleEndian?: boolean) => number;
      out[i * numComponents + c] = getter.call(bin, elementStart + c * size, true);
    }
  }
  return out;
}

export interface GlbMeshGeometry {
  /** Flat [x0,y0,z0, x1,y1,z1, ...] in the model's own local space. */
  position: Float64Array;
  /** Triangle list, 3 indices per face. */
  index: Uint32Array;
}

/**
 * Parse the first mesh's first primitive out of a .glb file. Molly only ever
 * ships single-mesh fish models — if that stops being true, this is the
 * place to add a mesh/primitive selector, not a silent "first one wins".
 */
export function readGlbMeshGeometry(bytes: ArrayBuffer): GlbMeshGeometry {
  const header = new DataView(bytes, 0, 12);
  if (header.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("Not a .glb file (bad magic)");
  }

  let json: GltfJson | null = null;
  let bin: DataView | null = null;
  let offset = 12;
  const decoder = new TextDecoder("utf-8");
  while (offset < bytes.byteLength) {
    const chunkView = new DataView(bytes, offset, 8);
    const chunkLength = chunkView.getUint32(0, true);
    const chunkTypeBytes = new Uint8Array(bytes, offset + 4, 4);
    const chunkType = decoder.decode(chunkTypeBytes).replace(/\0/g, "");
    const chunkStart = offset + 8;
    if (chunkType === "JSON") {
      json = JSON.parse(decoder.decode(new Uint8Array(bytes, chunkStart, chunkLength))) as GltfJson;
    } else if (chunkType === "BIN") {
      bin = new DataView(bytes, chunkStart, chunkLength);
    }
    offset = chunkStart + chunkLength;
  }
  if (!json) throw new Error(".glb has no JSON chunk");
  if (!bin) throw new Error(".glb has no BIN chunk");

  const primitive = json.meshes[0]?.primitives[0];
  if (!primitive) throw new Error(".glb has no mesh primitives");
  if (primitive.indices === undefined) throw new Error(".glb primitive has no index accessor");

  const position = readAccessor(json, bin, primitive.attributes.POSITION);
  const rawIndex = readAccessor(json, bin, primitive.indices);
  const index = Uint32Array.from(rawIndex);

  return { position, index };
}
