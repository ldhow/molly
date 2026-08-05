import { StyleSheet, Text, View } from "react-native";

import { palette, radius, spacing } from "@/shared/constants/theme";

import type { DayBar } from "../utils/stats";

const BAR_MAX_HEIGHT = 84;

export function WeekBars({ days }: { days: DayBar[] }) {
  const max = Math.max(30, ...days.map((d) => d.minutes));
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Last 7 days</Text>
      <View style={styles.row}>
        {days.map((day) => {
          const h = Math.max(3, (day.minutes / max) * BAR_MAX_HEIGHT);
          const isToday = day === days[days.length - 1];
          return (
            <View key={day.date} style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  { height: h },
                  isToday && styles.todayBar,
                  day.minutes === 0 && styles.emptyBar,
                ]}
              />
              <Text style={[styles.dayLabel, isToday && styles.todayLabel]}>{day.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  title: { color: palette.textDim, fontSize: 13, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: BAR_MAX_HEIGHT + 24,
  },
  barSlot: { alignItems: "center", gap: 6, flex: 1 },
  bar: {
    width: 14,
    borderRadius: 7,
    backgroundColor: palette.accentDark,
  },
  todayBar: { backgroundColor: palette.accent },
  emptyBar: { backgroundColor: palette.border },
  dayLabel: { color: palette.textFaint, fontSize: 11 },
  todayLabel: { color: palette.accent, fontWeight: "700" },
});
