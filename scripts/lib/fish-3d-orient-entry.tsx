// Orientation + eye-placement calibration tool: shows the RAW short_molly.glb
// mesh (no PCA remap, freely orbit-able) side by side with the app's actual
// pipeline (createGlbFishMesh) so a person can look at the real shape, tell
// which end is the nose and which side is the back, and dial in
// xSign/ySign/zSign and the eye's position live until the right panel
// matches — then copy the result straight into fish-mesh-3d.ts.
//
// Why this exists: PCA finds the three axes but not which end/face is
// which, and getting that wrong from a 2D projection or by inference is
// exactly how the sign got flipped before. This tool exists so a human
// looks at the actual geometry instead.
import { Canvas, useThree } from "@react-three/fiber";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  createGlbFishMesh,
  remapGlbMesh,
  DEFAULT_GLB_MARKERS,
  type GlbEyeOverride,
  type GlbFinTintOverride,
  type GlbMarkerFrac,
  type GlbMarkerKey,
  type GlbMarkers,
  type GlbOrientation,
  type GlbPatternBoundsOverride,
  type RemappedGlbMesh,
} from "@/shared/components/tank/fish-mesh-3d";
import { COLOR_DEFS, getColorDef, standardTraits } from "@/shared/fish/catalog";
import { readGlbMeshGeometry } from "@/shared/fish/glb-geometry";
import { buildSkinMap, type SkinMap } from "@/shared/fish/skin-map";
import type { ColorId } from "@/shared/fish/types";

const GLB_URL = "/short_molly.glb";

const DEFAULT_ORIENTATION: GlbOrientation = { xSign: -1, ySign: -1, zSign: -1 };
const DEFAULT_EYE: Pick<GlbEyeOverride, "zFrac" | "headFrac" | "yFrac" | "x"> = {
  zFrac: 0.15,
  headFrac: 0.3,
  yFrac: 0.7,
  x: 0.1,
};
// Mirrors the corresponding DEFAULT_* in fish-mesh-3d.ts — kept as literals
// here (not exported) since they're just this tool's starting point, not a
// shared contract; createGlbFishMesh() already falls back to its own
// defaults for anything left unset.
const DEFAULT_PATTERN_BOUNDS: GlbPatternBoundsOverride = {
  trimNoseZ: 0,
  trimTailZ: 0.08,
  trimTopY: 0.05,
  trimBottomY: 0.05,
};
const DEFAULT_FIN_TINT: GlbFinTintOverride = { radius: 0.35, strength: 0.6 };

const MARKER_META: { key: GlbMarkerKey; label: string; color: string }[] = [
  { key: "nose", label: "nose", color: "#37b6ff" },
  { key: "tail", label: "tail", color: "#ff5566" },
  { key: "dorsal", label: "dorsal/top", color: "#7ee787" },
  { key: "belly", label: "belly/bottom", color: "#ffd166" },
  { key: "right", label: "right side", color: "#ff9f43" },
  { key: "left", label: "left side", color: "#b57bff" },
];

function markerPosition(b: RemappedGlbMesh, f: GlbMarkerFrac): [number, number, number] {
  return [
    b.minX + f.x * (b.maxX - b.minX),
    b.minY + f.y * (b.maxY - b.minY),
    b.minZ + f.z * (b.maxZ - b.minZ),
  ];
}

/** Same DataTexture construction as fish-skin-texture.ts's (private)
 *  toTexture() — small enough, and platform-specific enough (this is a dev
 *  tool building its own scene, not going through requestSkin's cache/queue),
 *  that duplicating it here matches how tank-studio.ts's skinFor() already
 *  does its own inline texture creation rather than reaching into that
 *  module's internals. */
function textureFromSkinMap(map: SkinMap): THREE.Texture {
  const tex = new THREE.DataTexture(
    new Uint8Array(map.data.buffer, map.data.byteOffset, map.data.length),
    map.width,
    map.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Vanilla three.js OrbitControls, wired into R3F's own camera/canvas via a
 *  mount effect — matches the pattern already used in tank-studio.ts and
 *  fish-3d-driver.ts, just wrapped for JSX instead of a manual render loop. */
function FreeOrbit() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = false;
    controls.update();
    return () => controls.dispose();
  }, [camera, gl]);
  return null;
}

function Rig() {
  return (
    <>
      {/* Three.js convention: X=red, Y=green, Z=blue. */}
      <axesHelper args={[2]} />
      <gridHelper args={[6, 6, "#2a4a5e", "#16303f"]} />
      <hemisphereLight args={["#bfe6ff", "#1a2f3a", 1.1]} />
      <directionalLight position={[3, 4, 2]} intensity={1.2} />
    </>
  );
}

/** The unmodified source mesh — literally the accessor's own vertex
 *  positions, only re-centered on its own bounding-box middle so it sits at
 *  the origin. No PCA, no sign correction: what you see is what's in the file. */
function RawMesh({ wireframe }: { wireframe: boolean }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(GLB_URL)
      .then((r) => r.arrayBuffer())
      .then((bytes) => {
        if (cancelled) return;
        const parsed = readGlbMeshGeometry(bytes);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(Float32Array.from(parsed.position), 3),
        );
        geo.setIndex(new THREE.Uint32BufferAttribute(parsed.index, 1));
        geo.computeBoundingBox();
        const center = new THREE.Vector3();
        geo.boundingBox!.getCenter(center);
        geo.translate(-center.x, -center.y, -center.z);
        geo.computeVertexNormals();
        setGeometry(geo);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshNormalMaterial wireframe={wireframe} side={THREE.DoubleSide} flatShading={false} />
    </mesh>
  );
}

/** The real production mesh, built by the real createGlbFishMesh(), with the
 *  orientation/eye placement under test — genuinely the same code path the
 *  app ships, just with its defaults overridden for this tool. `bodyOpacity`
 *  reaches into the returned group's first child (the body mesh — always
 *  added before the eyes, see createGlbFishMesh) so the eye can be checked
 *  against the surface even when it's sunk inside the body. `skin` is the
 *  real baked pattern texture (or null for the flat gradient fallback) —
 *  passed straight through, same as the app's own requestSkin() would. */
function RigMesh({
  colorId,
  skin,
  orientation,
  eye,
  patternBounds,
  markers,
  finTint,
  bodyOpacity,
  bytes,
}: {
  colorId: ColorId;
  skin: THREE.Texture | null;
  orientation: GlbOrientation;
  eye: Partial<GlbEyeOverride>;
  patternBounds: Partial<GlbPatternBoundsOverride>;
  markers: GlbMarkers;
  finTint: Partial<GlbFinTintOverride>;
  bodyOpacity: number;
  bytes: ArrayBuffer | null;
}) {
  const groupRef = useRef<THREE.Group | null>(null);
  const palette = useMemo(() => getColorDef(colorId).palette, [colorId]);

  useEffect(() => {
    const group = groupRef.current;
    if (!bytes || !group) return;
    const fish = createGlbFishMesh(palette, {
      bytes,
      orientation,
      eye,
      patternBounds,
      markers,
      finTint,
      skin,
    });
    const body = fish.group.children[0] as THREE.Mesh;
    const mat = body.material as THREE.MeshStandardMaterial;
    mat.transparent = bodyOpacity < 1;
    mat.opacity = bodyOpacity;
    group.add(fish.group);
    return () => {
      group.remove(fish.group);
      fish.dispose();
    };
  }, [bytes, orientation, eye, patternBounds, markers, finTint, bodyOpacity, palette, skin]);

  return <primitive object={(groupRef.current ??= new THREE.Group())} />;
}

/** One small labelled sphere per anatomical landmark, each independently
 *  draggable (via sliders below, not literal dragging) along all three axes
 *  — starting points are best guesses, not derived from anything about the
 *  actual fin/pectoral positions, which vary per mesh. Only meaningful in
 *  the oriented (right) panel: the raw panel shows unprocessed coordinates
 *  these bounds don't correspond to. */
function AnatomyMarkers({
  bounds,
  markers,
}: {
  bounds: RemappedGlbMesh | null;
  markers: GlbMarkers;
}) {
  if (!bounds) return null;
  return (
    <>
      {MARKER_META.map((m) => (
        <mesh key={m.key} position={markerPosition(bounds, markers[m.key])}>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshBasicMaterial color={m.color} />
        </mesh>
      ))}
    </>
  );
}

function App() {
  const [wireframe, setWireframe] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [bodyOpacity, setBodyOpacity] = useState(1);
  const [orientation, setOrientation] = useState<GlbOrientation>(DEFAULT_ORIENTATION);
  const [eye, setEye] = useState(DEFAULT_EYE);
  const [patternBounds, setPatternBounds] = useState(DEFAULT_PATTERN_BOUNDS);
  const [finTint, setFinTint] = useState(DEFAULT_FIN_TINT);
  const [markers, setMarkers] = useState<GlbMarkers>(DEFAULT_GLB_MARKERS);
  const [colorId, setColorId] = useState<ColorId>("goldDust");
  const [showPattern, setShowPattern] = useState(false);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    fetch(GLB_URL)
      .then((r) => r.arrayBuffer())
      .then(setBytes);
  }, []);

  // The real bake (buildSkinMap), same as the app's requestSkin() would
  // produce — lets a pattern's landmark (e.g. goldDust's dark head) be
  // checked against the anatomy markers directly, not just the flat
  // back/mid/belly gradient every fish falls back to before its skin loads.
  const skin = useMemo(() => {
    if (!showPattern) return null;
    const def = getColorDef(colorId);
    const traits = standardTraits(colorId);
    return textureFromSkinMap(buildSkinMap(traits, def));
  }, [colorId, showPattern]);

  // Textures are a GPU resource useMemo can't free on its own — dispose
  // whichever one this effect closed over as soon as a newer one replaces it
  // (or on unmount), without calling setState here (that's what the memo above is for).
  useEffect(() => {
    return () => skin?.dispose();
  }, [skin]);

  const bounds = useMemo(
    () => (bytes ? remapGlbMesh(bytes, orientation) : null),
    [bytes, orientation],
  );

  function flip(axis: keyof GlbOrientation) {
    setOrientation((o) => ({ ...o, [axis]: o[axis] === 1 ? -1 : 1 }));
  }

  function setEyeField(field: keyof typeof DEFAULT_EYE, value: number) {
    setEye((e) => ({ ...e, [field]: value }));
  }

  function setPatternBoundsField(field: keyof GlbPatternBoundsOverride, value: number) {
    setPatternBounds((p) => ({ ...p, [field]: value }));
  }

  function setFinTintField(field: keyof GlbFinTintOverride, value: number) {
    setFinTint((f) => ({ ...f, [field]: value }));
  }

  function setMarkerAxis(key: GlbMarkerKey, axis: keyof GlbMarkerFrac, value: number) {
    setMarkers((m) => ({ ...m, [key]: { ...m[key], [axis]: value } }));
  }

  const negativeCount = [orientation.xSign, orientation.ySign, orientation.zSign].filter(
    (s) => s === -1,
  ).length;
  const isProperRotation = negativeCount % 2 === 0;

  async function copyCode() {
    const code = [
      `const GLB_ORIENTATION: GlbOrientation = { xSign: ${orientation.xSign}, ySign: ${orientation.ySign}, zSign: ${orientation.zSign} };`,
      `// eye override: { zFrac: ${eye.zFrac}, headFrac: ${eye.headFrac}, yFrac: ${eye.yFrac}, x: ${eye.x} }`,
      `// pattern bounds override: { trimNoseZ: ${patternBounds.trimNoseZ}, trimTailZ: ${patternBounds.trimTailZ}, trimTopY: ${patternBounds.trimTopY}, trimBottomY: ${patternBounds.trimBottomY} }`,
      `// fin tint override: { radius: ${finTint.radius}, strength: ${finTint.strength} }`,
      `// markers override: ${JSON.stringify(markers)}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard permission denied — the alert below is the fallback
    }
    alert(code);
  }

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative", borderRight: "1px solid #1d3a4d" }}>
          <div style={panelLabelStyle}>RAW model — drag to orbit, scroll to zoom</div>
          <Canvas camera={{ position: [4, 3, 6], fov: 45 }} style={{ background: "#04121c" }}>
            <Rig />
            <FreeOrbit />
            <RawMesh wireframe={wireframe} />
          </Canvas>
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          <div style={panelLabelStyle}>
            App-oriented — nose should point −Z (blue axis), back should face +Y (green). Markers:{" "}
            {MARKER_META.map((m) => (
              <span key={m.key} style={{ color: m.color }}>
                ● {m.label}{" "}
              </span>
            ))}
          </div>
          <Canvas camera={{ position: [4, 3, 6], fov: 45 }} style={{ background: "#04121c" }}>
            <Rig />
            <FreeOrbit />
            <RigMesh
              colorId={colorId}
              skin={skin}
              orientation={orientation}
              eye={eye}
              patternBounds={patternBounds}
              markers={markers}
              finTint={finTint}
              bodyOpacity={bodyOpacity}
              bytes={bytes}
            />
            {showMarkers ? <AnatomyMarkers bounds={bounds} markers={markers} /> : null}
          </Canvas>
        </div>
      </div>
      <div style={barStyle}>
        <div style={rowStyle}>
          <label style={fieldStyle}>
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(e) => setWireframe(e.target.checked)}
            />
            wireframe (raw)
          </label>
          <label style={fieldStyle}>
            <input
              type="checkbox"
              checked={showMarkers}
              onChange={(e) => setShowMarkers(e.target.checked)}
            />
            anatomy markers
          </label>
          <label style={fieldStyle}>
            <input
              type="checkbox"
              checked={showPattern}
              onChange={(e) => setShowPattern(e.target.checked)}
            />
            real color pattern
          </label>
          <select
            value={colorId}
            disabled={!showPattern}
            onChange={(e) => setColorId(e.target.value as ColorId)}
            style={selectStyle}
          >
            {COLOR_DEFS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <label style={fieldStyle}>
            body opacity
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={bodyOpacity}
              onChange={(e) => setBodyOpacity(Number(e.target.value))}
            />
          </label>
          <span style={dividerStyle} />
          {(["xSign", "ySign", "zSign"] as const).map((axis) => (
            <button key={axis} onClick={() => flip(axis)} style={buttonStyle}>
              {axis}: {orientation[axis] > 0 ? "+1" : "−1"}
            </button>
          ))}
          <span style={{ color: isProperRotation ? "#7ee787" : "#ffb86b", fontSize: 12 }}>
            {isProperRotation ? "proper rotation" : "mirrored (harmless on a symmetric body)"}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={copyCode}
            style={{ ...buttonStyle, background: "#2f7dd9", borderColor: "#2f7dd9" }}
          >
            Copy orientation + eye code
          </button>
        </div>
        <div style={rowStyle}>
          <span style={{ color: "#8fb3cc", fontSize: 11 }}>
            eye: nose ({bounds ? bounds.minZ.toFixed(2) : "…"}) → tail (
            {bounds ? bounds.maxZ.toFixed(2) : "…"})
          </span>
          <label style={fieldStyle}>
            distance from nose
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={eye.zFrac}
              onChange={(e) => setEyeField("zFrac", Number(e.target.value))}
            />
            {eye.zFrac.toFixed(2)}
          </label>
          <label style={fieldStyle}>
            head region size
            <input
              type="range"
              min={0.05}
              max={0.6}
              step={0.01}
              value={eye.headFrac}
              onChange={(e) => setEyeField("headFrac", Number(e.target.value))}
            />
            {eye.headFrac.toFixed(2)}
          </label>
          <label style={fieldStyle}>
            height within head
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={eye.yFrac}
              onChange={(e) => setEyeField("yFrac", Number(e.target.value))}
            />
            {eye.yFrac.toFixed(2)}
          </label>
          <label style={fieldStyle}>
            eye separation
            <input
              type="range"
              min={0}
              max={0.4}
              step={0.01}
              value={eye.x}
              onChange={(e) => setEyeField("x", Number(e.target.value))}
            />
            {eye.x.toFixed(2)}
          </label>
        </div>
        <div style={rowStyle}>
          <span style={{ color: "#8fb3cc", fontSize: 11 }}>
            pattern trim (excludes fin tips from skin mapping so it lands on the body, not stretched
            to cover the fins too):
          </span>
          <label style={fieldStyle}>
            nose
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={patternBounds.trimNoseZ}
              onChange={(e) => setPatternBoundsField("trimNoseZ", Number(e.target.value))}
            />
            {patternBounds.trimNoseZ.toFixed(2)}
          </label>
          <label style={fieldStyle}>
            tail
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={patternBounds.trimTailZ}
              onChange={(e) => setPatternBoundsField("trimTailZ", Number(e.target.value))}
            />
            {patternBounds.trimTailZ.toFixed(2)}
          </label>
          <label style={fieldStyle}>
            top/dorsal
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={patternBounds.trimTopY}
              onChange={(e) => setPatternBoundsField("trimTopY", Number(e.target.value))}
            />
            {patternBounds.trimTopY.toFixed(2)}
          </label>
          <label style={fieldStyle}>
            bottom/belly
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={patternBounds.trimBottomY}
              onChange={(e) => setPatternBoundsField("trimBottomY", Number(e.target.value))}
            />
            {patternBounds.trimBottomY.toFixed(2)}
          </label>
        </div>
        <div style={rowStyle}>
          <span style={{ color: "#8fb3cc", fontSize: 11 }}>
            fin tint (blends palette.fin in near the tail/dorsal/belly/side markers below):
          </span>
          <label style={fieldStyle}>
            radius
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={finTint.radius}
              onChange={(e) => setFinTintField("radius", Number(e.target.value))}
            />
            {finTint.radius.toFixed(2)}
          </label>
          <label style={fieldStyle}>
            strength
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={finTint.strength}
              onChange={(e) => setFinTintField("strength", Number(e.target.value))}
            />
            {finTint.strength.toFixed(2)}
          </label>
        </div>
        <div style={{ ...rowStyle, flexWrap: "wrap", alignItems: "flex-start" }}>
          <span style={{ color: "#8fb3cc", fontSize: 11, alignSelf: "flex-start", marginTop: 4 }}>
            markers — x/y/z, each 0..1 across that axis&apos;s full range (e.g. z: 0=nose, 1=tail).
            Also drives fin tint above (nose excluded — it&apos;s a body landmark, not a fin):
          </span>
          {MARKER_META.map((m) => (
            <div key={m.key} style={markerCardStyle}>
              <span style={{ color: m.color, fontSize: 12 }}>● {m.label}</span>
              {(["x", "y", "z"] as const).map((axis) => (
                <label key={axis} style={{ ...fieldStyle, fontSize: 11 }}>
                  {axis}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={markers[m.key][axis]}
                    onChange={(e) => setMarkerAxis(m.key, axis, Number(e.target.value))}
                    style={{ width: 70 }}
                  />
                  {markers[m.key][axis].toFixed(2)}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const panelLabelStyle: CSSProperties = {
  position: "absolute",
  top: 8,
  left: 8,
  zIndex: 1,
  color: "#8fb3cc",
  font: "11px -apple-system, sans-serif",
  background: "#00000090",
  padding: "4px 8px",
  borderRadius: 6,
  maxWidth: "90%",
};

const barStyle: CSSProperties = {
  flex: "none",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "8px 12px",
  background: "#10222f",
  borderTop: "1px solid #1d3a4d",
  color: "#eaf6ff",
  font: "13px -apple-system, sans-serif",
};

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };

const dividerStyle: CSSProperties = { width: 1, background: "#1d3a4d", alignSelf: "stretch" };

const fieldStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  color: "#8fb3cc",
  fontSize: 12,
};

const selectStyle: CSSProperties = {
  font: "inherit",
  fontSize: 12,
  background: "#0a1a24",
  color: "#eaf6ff",
  border: "1px solid #1d3a4d",
  borderRadius: 6,
  padding: "4px 6px",
};

const buttonStyle: CSSProperties = {
  font: "inherit",
  background: "#16394f",
  color: "#eaf6ff",
  border: "1px solid #1d3a4d",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
};

const markerCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "4px 8px",
  background: "#0a1a24",
  border: "1px solid #1d3a4d",
  borderRadius: 6,
};

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");
createRoot(rootEl).render(<App />);
