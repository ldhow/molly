import { useSessionController } from "../hooks/use-session-controller";
import { configureNotificationHandler } from "../utils/notifications";

configureNotificationHandler();

/**
 * Mounts the session runtime exactly once from the root layout: cold-start
 * judgment of an orphaned snapshot, AppState grace-period tracking, and
 * derived completion. Renders nothing.
 */
export function SessionRuntime() {
  useSessionController();
  return null;
}
