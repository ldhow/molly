import { StyleSheet, Text, View } from "react-native";

import { palette, spacing } from "@/shared/constants/theme";
import type { BodyId, DorsalId, LifeStage, TailId } from "@/shared/fish/types";

import { Chip } from "./chip";

interface Props {
  stage: LifeStage;
  body: BodyId;
  tail: TailId;
  dorsal: DorsalId;
  patternSeed: number;
  patternSeedBuckets: number;
  onStage: (v: LifeStage) => void;
  onBody: (v: BodyId) => void;
  onTail: (v: TailId) => void;
  onDorsal: (v: DorsalId) => void;
  onPatternSeed: (v: number) => void;
}

const STAGES: LifeStage[] = ["egg", "fry", "juvenile", "adult"];
const BODIES: BodyId[] = ["standard", "balloon"];
const TAILS: TailId[] = ["round", "lyretail"];
const DORSALS: DorsalId[] = ["standard", "sailfin"];

/**
 * The axes a breed does NOT own — anatomy and the per-individual pattern
 * jitter. Applied to every preview at once, so a breed can be judged against
 * a shape it will actually be rolled onto rather than only the default one.
 */
export function TraitToggles({
  stage,
  body,
  tail,
  dorsal,
  patternSeed,
  patternSeedBuckets,
  onStage,
  onBody,
  onTail,
  onDorsal,
  onPatternSeed,
}: Props) {
  return (
    <View style={styles.root}>
      <Row label="Stage">
        {STAGES.map((s) => (
          <Chip key={s} label={s} active={stage === s} onPress={() => onStage(s)} />
        ))}
      </Row>
      <Row label="Body">
        {BODIES.map((b) => (
          <Chip key={b} label={b} active={body === b} onPress={() => onBody(b)} />
        ))}
        {TAILS.map((t) => (
          <Chip key={t} label={t} active={tail === t} onPress={() => onTail(t)} />
        ))}
        {DORSALS.map((d) => (
          <Chip key={d} label={d} active={dorsal === d} onPress={() => onDorsal(d)} />
        ))}
      </Row>
      <Row label="Pattern seed">
        {Array.from({ length: patternSeedBuckets }, (_, i) => (
          <Chip
            key={i}
            label={String(i)}
            active={patternSeed === i}
            onPress={() => onPatternSeed(i)}
          />
        ))}
      </Row>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  block: { gap: 4 },
  label: { color: palette.textFaint, fontSize: 11, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
});
