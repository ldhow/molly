// Mounts a single real 3D fish (TankCanvas3D, "center" mode) that live-shows
// whatever ColorDef the vanilla-JS color editor page is currently editing.
//
// Bridging is by polling a plain global the editor's own inline script
// writes to (window.__colorPreviewState / __colorPreviewVersion), not an
// event, so there's no listener-attached-too-late race: on mount this reads
// whatever's already there, which is correct by the time this bundle's
// effects run (the editor's own <script> has already executed synchronously
// by then).
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

import { TankCanvas3D } from "@/shared/components/tank/tank-canvas-3d";
import type { TankFish } from "@/shared/components/tank/tank-canvas";
import { COLOR_DEFS, standardTraits } from "@/shared/fish/catalog";
import type { ColorDef, FishTraits, LifeStage } from "@/shared/fish/types";

import { invalidateSkin } from "../../src/shared/components/tank/fish-skin-texture";

declare global {
  interface Window {
    __colorPreviewVersion?: number;
    __colorPreviewState?: {
      def: ColorDef;
      patternSeed: number;
      stage?: LifeStage;
      status?: "alive" | "dead";
    };
  }
}

interface PreviewState {
  traits: FishTraits;
  stage: LifeStage;
  status: "alive" | "dead";
  gen: number;
}

function App() {
  const [state, setState] = useState<PreviewState>({
    traits: standardTraits(COLOR_DEFS[0].id),
    stage: "adult",
    status: "alive",
    gen: 0,
  });

  useEffect(() => {
    let lastVersion = -1;
    const id = window.setInterval(() => {
      const version = window.__colorPreviewVersion ?? 0;
      if (version === lastVersion) return;
      lastVersion = version;
      const snap = window.__colorPreviewState;
      if (!snap?.def) return;

      // Mutate the matching entry in this bundle's OWN copy of COLOR_DEFS
      // (a separate module instance from the editor page's plain-JS `current`
      // object) so getColorDef() inside Fish3D picks up the edit on remount.
      const target = COLOR_DEFS.find((d) => d.id === snap.def.id);
      if (!target) return;
      Object.assign(target, snap.def);

      const traits: FishTraits = {
        ...standardTraits(snap.def.id),
        patternSeed: snap.patternSeed ?? 0,
      };
      // Cache is keyed on traits alone, so bust it before the remount below
      // asks for a fresh bake of the same traits with the new def content.
      invalidateSkin(traits);
      setState((s) => ({
        traits,
        stage: snap.stage ?? s.stage,
        status: snap.status ?? s.status,
        gen: s.gen + 1,
      }));
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  const fish: TankFish = {
    // Keying on `gen` forces Fish3D/DeadFish3D to fully unmount+remount on
    // every edit, which is what re-triggers requestSkin() — a live prop
    // change alone wouldn't, since the skin bake only happens in a mount effect.
    key: `preview-${state.traits.color}-${state.gen}`,
    traits: state.traits,
    stage: state.stage,
    status: state.status,
    scale: 1,
    seed: 0.4,
  };

  return (
    <TankCanvas3D
      fish={[fish]}
      mode="center"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    />
  );
}

const root = document.getElementById("root3d");
if (!root) throw new Error("missing #root3d");
createRoot(root).render(<App />);
