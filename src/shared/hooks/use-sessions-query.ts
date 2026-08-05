import { useQuery } from "@tanstack/react-query";
import { desc } from "drizzle-orm";

import { db } from "@/db/client";
import { sessions, type SessionRow } from "@/db/schema";

export const SESSIONS_QUERY_KEY = ["sessions"] as const;

/** All session records, newest first. Invalidated when a session ends. */
export function useSessionsQuery() {
  return useQuery<SessionRow[]>({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: () => db.select().from(sessions).orderBy(desc(sessions.startedAt)),
  });
}
