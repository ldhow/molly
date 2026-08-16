import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";
import { strainCode, type BreedRecipe } from "@/shared/fish/generated-breed";

import { BATCH_SIZE } from "../hooks/use-breed-lab";

interface Props {
  heroRecipe: BreedRecipe;
  heroSeed: number;
  onRollBatch: () => void;
  onRollOne: () => void;
  onFocusSeed: (raw: string) => boolean;
}

export function BreedLabPanel({
  heroRecipe,
  heroSeed,
  onRollBatch,
  onRollOne,
  onFocusSeed,
}: Props) {
  const [seedInput, setSeedInput] = useState("");
  const [seedError, setSeedError] = useState(false);

  const submitSeed = () => {
    const ok = onFocusSeed(seedInput);
    setSeedError(!ok);
    if (ok) setSeedInput("");
  };

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Pressable style={[styles.button, styles.primary]} onPress={onRollBatch}>
          <Text style={styles.primaryText}>🎲 Roll {BATCH_SIZE} breeds</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onRollOne}>
          <Text style={styles.buttonText}>+1</Text>
        </Pressable>
      </View>

      <Text style={styles.heroName}>
        {heroRecipe.name} · {strainCode(heroSeed)}
      </Text>
      <Text style={styles.heroDesc}>{heroRecipe.description}</Text>
      <View style={styles.row}>
        {/* `selectable` gives native long-press-copy on both platforms —
            expo-clipboard isn't a dependency and this doesn't need to become
            the first reason to add one. `Share` is the belt-and-braces path
            for getting a seed off the device and into the preview script. */}
        <Text selectable style={styles.mono}>
          {heroRecipe.id}
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => void Share.share({ message: heroRecipe.id })}
        >
          <Text style={styles.buttonText}>Share seed</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <TextInput
          style={[styles.input, seedError && styles.inputError]}
          value={seedInput}
          onChangeText={(t) => {
            setSeedInput(t);
            setSeedError(false);
          }}
          onSubmitEditing={submitSeed}
          placeholder="paste gen:xxxx or a seed number"
          placeholderTextColor={palette.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
        />
        <Pressable style={styles.button} onPress={submitSeed}>
          <Text style={styles.buttonText}>Load</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  button: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonText: { color: palette.textFaint, fontSize: 12, fontWeight: "600" },
  primary: { backgroundColor: palette.accentDark, borderColor: palette.accent },
  primaryText: { color: palette.text, fontSize: 13, fontWeight: "700" },
  heroName: { color: palette.text, fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  heroDesc: { color: palette.textDim, fontSize: 12 },
  mono: { color: palette.accent, fontSize: 12, fontFamily: "monospace" },
  input: {
    flex: 1,
    minWidth: 160,
    color: palette.text,
    fontSize: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  inputError: { borderColor: palette.danger },
});
