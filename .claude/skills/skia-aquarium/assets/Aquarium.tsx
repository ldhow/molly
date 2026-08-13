import React, { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Canvas, Fill, Group, LinearGradient, Path, RadialGradient,
  Shader, Skia, vec, useClock,
} from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";
import { Fish } from "./Fish";
import { SPECIES } from "./species";
import { feedAt, useSchool } from "./useSchool";

/** Caustics: three octaves of interfering sine bands, strongest near the surface. */
const caustics = Skia.RuntimeEffect.Make(`
uniform float t;
uniform vec2 res;
half4 main(vec2 pos) {
  vec2 uv = pos / res;
  float d = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i) + 1.0;
    d += sin(uv.x * 9.0 * fi + t * 0.6 * fi) * cos(uv.y * 7.0 * fi - t * 0.4 * fi);
  }
  float band = smoothstep(0.55, 1.4, abs(d));
  float fade = smoothstep(1.0, 0.25, uv.y);
  float a = band * fade * 0.30;
  return half4(vec3(0.72, 0.92, 1.0) * a, a);
}`)!;

const STOCK = {
  neon_tetra: 7,
  guppy: 3,
  molly: 2,
  corydoras: 2,
  betta: 1,
};

export function Aquarium() {
  const { width, height } = useWindowDimensions();
  const { state, frame, time, touch, members, specs } = useSchool(STOCK, width, height);
  const clock = useClock();

  const uniforms = useDerivedValue(() => ({ t: clock.value / 1000, res: [width, height] }));

  // Static scenery: built once, never rebuilt. Rebuilding gravel every frame is
  // the most common reason these scenes drop below 60fps.
  const gravel = useMemo(() => {
    const b = (Skia as any).PathBuilder ? (Skia as any).PathBuilder.Make() : Skia.Path.Make();
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 260; i++) {
      const gx = rnd() * width;
      const gy = height - rnd() * rnd() * height * 0.16;
      b.addCircle ? b.addCircle(gx, gy, 2 + rnd() * 4) : null;
    }
    return typeof b.build === "function" ? b.build() : b;
  }, [width, height]);

  const plants = useMemo(() => {
    const b = (Skia as any).PathBuilder ? (Skia as any).PathBuilder.Make() : Skia.Path.Make();
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 14; i++) {
      const x0 = rnd() * width;
      const h = height * (0.18 + rnd() * 0.26);
      const lean = (rnd() - 0.5) * 60;
      b.moveTo(x0, height);
      b.cubicTo(x0 + lean * 0.3, height - h * 0.4, x0 + lean, height - h * 0.8, x0 + lean * 1.3, height - h);
      b.cubicTo(x0 + lean * 0.9, height - h * 0.75, x0 + lean * 0.2, height - h * 0.35, x0 + 9, height);
      b.close();
    }
    return typeof b.build === "function" ? b.build() : b;
  }, [width, height]);

  // A single slow "current" that both plants and fish feel, so the whole tank
  // breathes as one body of water.
  const plantSway = useDerivedValue(() => {
    const s = Math.sin(clock.value / 1000 * 0.5) * 0.035;
    return [{ translateY: height }, { skewX: s }, { translateY: -height }];
  });

  const tap = Gesture.Tap().onEnd((e) => {
    feedAt(touch, e.x, e.y);
  });

  return (
    <GestureDetector gesture={tap}>
      <Canvas style={{ flex: 1 }}>
        {/* water */}
        <Fill>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={["#1E6F8E", "#134F6B", "#0A2E42"]}
            positions={[0, 0.55, 1]}
          />
        </Fill>
        <Fill>
          <RadialGradient
            c={vec(width * 0.35, -40)}
            r={height * 0.7}
            colors={["#7FD4E855", "#7FD4E800"]}
          />
        </Fill>

        {/* caustics */}
        <Fill>
          <Shader source={caustics} uniforms={uniforms} />
        </Fill>

        {/* background plants */}
        <Group opacity={0.35} transform={plantSway}>
          <Path path={plants} color="#0C3A34" />
        </Group>

        {/* creatures, sorted back to front by depth */}
        {members
          .map((m, i) => ({ m, i }))
          .sort((a, b) => a.m.z - b.m.z)
          .map(({ m, i }) => (
            <Fish
              key={i}
              index={i}
              spec={specs[i] ?? SPECIES.guppy}
              state={state}
              frame={frame}
              time={time}
              scale={m.scale * (0.7 + m.z * 0.4)}
              z={m.z}
            />
          ))}

        {/* foreground */}
        <Group opacity={0.9} transform={plantSway}>
          <Path path={gravel} color="#3A3226" />
        </Group>
        <Fill>
          <RadialGradient
            c={vec(width / 2, height / 2)}
            r={Math.max(width, height) * 0.75}
            colors={["#00000000", "#00000066"]}
          />
        </Fill>
      </Canvas>
    </GestureDetector>
  );
}
