import { Platform } from "react-native";

import { DYING_NOTIFICATION_DELAY_S, NOTIFICATION_COPY } from "../constants";

/**
 * expo-notifications can throw at import time in Expo Go on Android (push
 * support was removed from Expo Go in SDK 53). Import lazily and degrade to
 * a no-op so the notification layer can never take the app down — sessions
 * work fine without notifications.
 */
type NotificationsModule = typeof import("expo-notifications");

let notificationsModule: NotificationsModule | null | undefined;

function getNotifications(): NotificationsModule | null {
  if (notificationsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      notificationsModule = require("expo-notifications") as NotificationsModule;
    } catch {
      notificationsModule = null;
    }
  }
  return notificationsModule;
}

/**
 * Only this feature schedules notifications, so ids can live at module level;
 * after an app kill they're lost, but terminal states cancel everything anyway.
 */
let dyingNotificationId: string | null = null;

export function configureNotificationHandler() {
  try {
    const Notifications = getNotifications();
    if (!Notifications) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Notifications unavailable — the app works without them.
  }
}

export async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  try {
    const Notifications = getNotifications();
    if (!Notifications) return;
    await Notifications.setNotificationChannelAsync("session", {
      name: "Focus sessions",
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch {
    // Notifications unavailable (e.g. simulator) — the app works without them.
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const Notifications = getNotifications();
    if (!Notifications) return false;
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function scheduleCompletionNotification(secondsFromNow: number) {
  try {
    const Notifications = getNotifications();
    if (!Notifications) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: NOTIFICATION_COPY.completedTitle,
        body: NOTIFICATION_COPY.completedBody,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(secondsFromNow)),
        channelId: "session",
      },
    });
  } catch {
    // best-effort
  }
}

export async function scheduleDyingNotification() {
  try {
    const Notifications = getNotifications();
    if (!Notifications) return;
    dyingNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: NOTIFICATION_COPY.dyingTitle,
        body: NOTIFICATION_COPY.dyingBody,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: DYING_NOTIFICATION_DELAY_S,
        channelId: "session",
      },
    });
  } catch {
    dyingNotificationId = null;
  }
}

export async function cancelDyingNotification() {
  if (!dyingNotificationId) return;
  const id = dyingNotificationId;
  dyingNotificationId = null;
  try {
    const Notifications = getNotifications();
    if (!Notifications) return;
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // already fired or unavailable
  }
}

/** Terminal states: wipe everything this app ever scheduled. */
export async function cancelAllSessionNotifications() {
  dyingNotificationId = null;
  try {
    const Notifications = getNotifications();
    if (!Notifications) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // best-effort
  }
}
