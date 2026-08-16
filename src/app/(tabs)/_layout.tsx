import { Tabs } from "expo-router";
import { Text } from "react-native";

import { palette } from "@/shared/constants/theme";

function icon(emoji: string) {
  return function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textFaint,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Focus", tabBarIcon: icon("⏱️") }} />
      <Tabs.Screen name="tank" options={{ title: "Tank", tabBarIcon: icon("🐟") }} />
      <Tabs.Screen name="stats" options={{ title: "Stats", tabBarIcon: icon("📊") }} />
      <Tabs.Screen name="fishdex" options={{ title: "Fishdex", tabBarIcon: icon("📖") }} />
      <Tabs.Screen
        name="test"
        options={{ title: "Test", tabBarIcon: icon("☠️"), href: __DEV__ ? undefined : null }}
      />
    </Tabs>
  );
}
