import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

import { db } from "@/db/client";
import migrations from "@/db/migrations/migrations";
import { SessionRuntime } from "@/features/session";
import { AppProviders } from "@/providers/app-providers";
import { palette, spacing } from "@/shared/constants/theme";

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorBody}>{error.message}</Text>
      </View>
    );
  }
  if (!success) {
    // Migrations run in milliseconds — the splash screen covers this.
    return <View style={styles.center} />;
  }

  return (
    <AppProviders>
      <SessionRuntime />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="session" options={{ gestureEnabled: false, animation: "fade" }} />
        <Stack.Screen name="holding-tank" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="tank-preview" options={{ animation: "slide_from_right" }} />
      </Stack>
      <StatusBar style="light" />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: { color: palette.text, fontSize: 18, fontWeight: "700" },
  errorBody: { color: palette.textDim, fontSize: 13, textAlign: "center" },
});
