import { createRoot } from "react-dom/client";
import { useState } from "react";

import { TankCanvas3D } from "@/shared/components/tank/tank-canvas-3d";

import { SCENARIOS } from "./tank-3d-react-mock-fish";

const PRESETS = Object.keys(SCENARIOS);

function App() {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [mode, setMode] = useState<"tank" | "center">("tank");

  return (
    <div style={{ position: "fixed", inset: 0, background: "#04121c" }}>
      <TankCanvas3D
        fish={SCENARIOS[preset]}
        mode={mode}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          display: "flex",
          gap: 8,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as "tank" | "center")}>
          <option value="tank">tank</option>
          <option value="center">center</option>
        </select>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
