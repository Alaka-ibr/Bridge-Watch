import { useCallback, useEffect, useRef, useState } from "react";

export type DesktopPermission = "unsupported" | "default" | "granted" | "denied";

/** Web Notifications is missing in some browsers and absent under jsdom. */
export function getDesktopNotificationSupport(): Notification | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { Notification?: typeof Notification }).Notification;
  if (!ctor) return null;
  try {
    // Instantiating proves the constructor is callable, not just present.
    return new ctor("", { silent: true });
  } catch {
    return null;
  }
}

export function getDesktopPermission(): DesktopPermission {
  const ctor = (typeof window !== "undefined"
    ? (window as unknown as { Notification?: typeof Notification }).Notification
    : undefined);
  if (!ctor) return "unsupported";
  return ctor.permission as DesktopPermission;
}

export interface UseDesktopNotificationsOptions {
  /** Master switch driven by the user preference */
  enabled: boolean;
}

export interface UseDesktopNotificationsResult {
  support: DesktopPermission;
  /** Ask the browser for permission. Must be called from a user gesture. */
  requestPermission: () => Promise<DesktopPermission>;
  /**
   * Show a native notification when the tab is in the background.
   *
   * Returns true when a notification was actually dispatched, which lets
   * callers fall back to in-app signalling.
   */
  notifyInBackground: (options: { title: string; body: string; tag?: string }) => boolean;
}

/**
 * Dispatches native desktop notifications via the Web Notifications API.
 *
 * Deliberately only fires when the document is hidden: if the operator is
 * already looking at the tab, the drawer is visible and a native popup would
 * be a duplicate.
 */
export function useDesktopNotifications({
  enabled,
}: UseDesktopNotificationsOptions): UseDesktopNotificationsResult {
  const [support, setSupport] = useState<DesktopPermission>(() => getDesktopPermission());
  const openNotificationsRef = useRef<Set<Notification>>(new Set());

  useEffect(() => {
    return () => {
      // Close anything still on screen so notifications do not outlive the page.
      for (const notification of openNotificationsRef.current) {
        try {
          notification.close();
        } catch {
          // Already dismissed by the user; nothing to do.
        }
      }
      openNotificationsRef.current.clear();
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<DesktopPermission> => {
    const ctor = (typeof window !== "undefined"
      ? (window as unknown as { Notification?: typeof Notification }).Notification
      : undefined);
    if (!ctor) {
      setSupport("unsupported");
      return "unsupported";
    }

    try {
      const result = (await ctor.requestPermission()) as DesktopPermission;
      setSupport(result);
      return result;
    } catch {
      // Older Safari only allows requestPermission from a gesture.
      setSupport(ctor.permission as DesktopPermission);
      return ctor.permission as DesktopPermission;
    }
  }, []);

  const notifyInBackground = useCallback(
    ({ title, body, tag }: { title: string; body: string; tag?: string }): boolean => {
      if (!enabled) return false;
      if (getDesktopPermission() !== "granted") return false;
      if (getDesktopNotificationSupport() === null) return false;
      if (typeof document !== "undefined" && !document.hidden) return false;

      const ctor = (window as unknown as { Notification: typeof Notification }).Notification;
      try {
        const notification = new ctor(title, {
          body,
          // Tagging collapses repeats of the same alert instead of stacking.
          tag,
          requireInteraction: true,
        });
        openNotificationsRef.current.add(notification);
        notification.onclose = () => openNotificationsRef.current.delete(notification);
        return true;
      } catch {
        return false;
      }
    },
    [enabled]
  );

  return { support, requestPermission, notifyInBackground };
}
