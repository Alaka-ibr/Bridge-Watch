import { useEffect, useRef } from "react";
import { useNotificationStore, type Notification } from "../stores/notificationStore";
import { useAlertChime, type ChimeName } from "./useAlertChime";
import { useDesktopNotifications } from "./useDesktopNotifications";

/** Only these priorities warrant interrupting the operator. */
const ALERT_PRIORITIES = new Set<Notification["priority"]>(["critical", "high"]);

export function chimeForPriority(priority: Notification["priority"]): ChimeName | null {
  if (priority === "critical") return "critical";
  if (priority === "high") return "high";
  return null;
}

export interface UseAlertNotifierOptions {
  soundEnabled: boolean;
  desktopEnabled: boolean;
}

export interface UseAlertNotifierResult {
  /** False when this browser has no Web Audio API. */
  soundSupported: boolean;
  /** False when this browser has no Web Notifications API. */
  desktopSupported: boolean;
  /** False until a user gesture has unlocked the AudioContext. */
  soundUnlocked: boolean;
  /** Current notification permission state. */
  desktopPermission: ReturnType<typeof useDesktopNotifications>["support"];
  /** Arm audio and/or ask for notification permission from a user gesture. */
  enableSound: () => void;
  requestDesktopPermission: () => Promise<void>;
}

/**
 * Watches the notification store and alerts the operator when a high or
 * critical notification arrives.
 *
 * Only genuinely new notifications fire: on mount the store is seeded with the
 * ids already present so a page reload does not replay every historical alert.
 */
export function useAlertNotifier({
  soundEnabled,
  desktopEnabled,
}: UseAlertNotifierOptions): UseAlertNotifierResult {
  const notifications = useNotificationStore((state) => state.notifications);

  const { supported: soundSupported, unlocked: soundUnlocked, unlock, play } = useAlertChime(
    soundEnabled
  );
  const {
    support: desktopPermission,
    requestPermission,
    notifyInBackground,
  } = useDesktopNotifications({ enabled: desktopEnabled });

  const seenIdsRef = useRef<Set<string> | null>(null);
  const primedRef = useRef(false);

  useEffect(() => {
    // Seed on the first pass so pre-existing notifications are not replayed.
    if (!primedRef.current) {
      primedRef.current = true;
      seenIdsRef.current = new Set(notifications.map((notification) => notification.id));
      return;
    }

    const seen = seenIdsRef.current;
    if (!seen) return;

    for (const notification of notifications) {
      if (seen.has(notification.id)) continue;
      seen.add(notification.id);

      if (!ALERT_PRIORITIES.has(notification.priority)) continue;

      const chime = chimeForPriority(notification.priority);
      if (chime) play(chime);

      notifyInBackground({
        title: notification.title,
        body: notification.message,
        tag: notification.id,
      });
    }
  }, [notifications, play, notifyInBackground]);

  return {
    soundSupported,
    desktopSupported: desktopPermission !== "unsupported",
    soundUnlocked,
    desktopPermission,
    enableSound: unlock,
    requestDesktopPermission: async () => {
      await requestPermission();
    },
  };
}
