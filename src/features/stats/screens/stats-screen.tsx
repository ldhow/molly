import { FlatList, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/shared/components/empty-state";
import { ScreenContainer } from "@/shared/components/screen-container";
import { palette, radius, spacing } from "@/shared/constants/theme";
import { getSpeciesDef } from "@/shared/creature/catalog";
import { resolveCreature } from "@/shared/creature/resolve";
import { getColorDef } from "@/shared/fish/catalog";
import { formatMinutes } from "@/shared/lib/dates";

import { useStats } from "../api/use-stats";
import { StatCard } from "../components/stat-card";
import { WeekBars } from "../components/week-bars";

export function StatsScreen() {
  const { stats, rows } = useStats();

  return (
    <ScreenContainer>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Stats</Text>
            <View style={styles.cardRow}>
              <StatCard label="Today" value={formatMinutes(stats.todayMinutes)} accent />
              <StatCard label="This week" value={formatMinutes(stats.weekMinutes)} />
            </View>
            <View style={styles.cardRow}>
              <StatCard label="Current streak" value={`${stats.currentStreak}d 🔥`} />
              <StatCard label="Best streak" value={`${stats.bestStreak}d`} />
            </View>
            <WeekBars days={stats.last7} />
            <Text style={styles.sectionTitle}>History</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            emoji="📈"
            title="No sessions yet"
            caption="Finish your first focus session and it will show up here."
          />
        }
        renderItem={({ item }) => {
          const resolved = resolveCreature(item);
          const name =
            resolved.speciesId === "molly"
              ? getColorDef(resolved.traits.color).name
              : (getSpeciesDef(resolved.speciesId).variants.find((v) => v.id === resolved.variant)
                  ?.name ?? getSpeciesDef(resolved.speciesId).name);
          const icon =
            item.outcome === "failed"
              ? "💀"
              : item.outcome === "abandoned"
                ? "🏳️"
                : getSpeciesDef(resolved.speciesId).emoji;
          return (
            <View style={styles.historyRow}>
              <Text style={styles.historyIcon}>{icon}</Text>
              <View style={styles.historyBody}>
                <Text style={styles.historyName}>{name}</Text>
                <Text style={styles.historyMeta}>
                  {item.localDate} · {formatMinutes(item.plannedMinutes)}
                </Text>
              </View>
              <Text
                style={[
                  styles.historyOutcome,
                  item.outcome === "completed" ? styles.outcomeOk : styles.outcomeBad,
                ]}
              >
                {item.outcome}
              </Text>
            </View>
          );
        }}
        contentContainerStyle={styles.listContent}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  title: {
    color: palette.text,
    fontSize: 28,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  cardRow: { flexDirection: "row", gap: spacing.md },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  listContent: { paddingBottom: spacing.xl },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  historyIcon: { fontSize: 20 },
  historyBody: { flex: 1, gap: 2 },
  historyName: { color: palette.text, fontSize: 15, fontWeight: "600" },
  historyMeta: { color: palette.textFaint, fontSize: 12 },
  historyOutcome: { fontSize: 12, fontWeight: "600" },
  outcomeOk: { color: palette.success },
  outcomeBad: { color: palette.danger },
});
