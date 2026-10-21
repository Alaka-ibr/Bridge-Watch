import { useEffect, useMemo, useRef } from "react";
import {
  NOTIFICATION_PRIORITY_ORDER,
  useNotificationStore,
  type Notification,
  type NotificationPriority,
} from "../stores/notificationStore";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { useAlertNotifier } from "../hooks/useAlertNotifier";

interface NotificationsDrawerProps {
  open: boolean;
  drawerId: string;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

const priorityLabelMap: Record<NotificationPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const priorityTextColorMap: Record<NotificationPriority, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  medium: "text-blue-400",
  low: "text-stellar-text-secondary",
};

const priorityDotColorMap: Record<NotificationPriority, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-blue-500",
  low: "bg-stellar-border",
};

const formatNotificationTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

/**
 * Renders the notifications drawer and provides keyboard/focus interactions
 * consistent with the existing mobile drawer patterns in this codebase.
 */
export default function NotificationsDrawer({
  open,
  drawerId,
  onClose,
}: NotificationsDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const liveRegionRef = useRef<HTMLParagraphElement | null>(null);
  const previousTopNotificationIdRef = useRef<string | null>(null);

  const notifications = useNotificationStore((state) => state.notifications);
  const markAsRead = useNotificationStore((state) => state.markAsRead);
  const markAllAsRead = useNotificationStore((state) => state.markAllAsRead);
  const clearReadNotifications = useNotificationStore(
    (state) => state.clearReadNotifications
  );

  const soundEnabled = useUserPreferencesStore((state) => state.soundEnabled);
  const desktopNotificationsEnabled = useUserPreferencesStore(
    (state) => state.notificationsEnabled
  );
  const setPreference = useUserPreferencesStore((state) => state.setPreference);

  const notifier = useAlertNotifier({
    soundEnabled,
    desktopEnabled: desktopNotificationsEnabled,
  });

  const groupedNotifications = useMemo(() => {
    const visibleNotifications = notifications.filter((n) => !n.dismissed);
    return NOTIFICATION_PRIORITY_ORDER.reduce<Record<NotificationPriority, Notification[]>>(
      (accumulator, priority) => {
        accumulator[priority] = visibleNotifications.filter(
          (notification) => notification.priority === priority
        );
        return accumulator;
      },
      {
        critical: [],
        high: [],
        medium: [],
        low: [],
      }
    );
  }, [notifications]);

  const allNotifications = useMemo(
    () => NOTIFICATION_PRIORITY_ORDER.flatMap((priority) => groupedNotifications[priority]),
    [groupedNotifications]
  );

  const unreadCount = allNotifications.filter((notification) => !notification.read).length;
  const hasReadNotifications = allNotifications.some((notification) => notification.read);
  const hasAnyNotifications = allNotifications.length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.setTimeout(() => {
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      firstFocusable?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!panelRef.current) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab") {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((element) => !element.hasAttribute("disabled"));

        if (!focusable.length) {
          return;
        }

        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? focusable.length - 1
            : currentIndex - 1
          : currentIndex === focusable.length - 1
            ? 0
            : currentIndex + 1;

        if (currentIndex !== -1) {
          event.preventDefault();
          focusable[nextIndex]?.focus();
        }
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const navigationButtons = Array.from(
          panelRef.current.querySelectorAll<HTMLButtonElement>(
            "[data-notification-item-action='mark-as-read']"
          )
        ).filter((button) => !button.disabled);

        if (!navigationButtons.length) {
          return;
        }

        const currentIndex = navigationButtons.indexOf(
          document.activeElement as HTMLButtonElement
        );

        if (currentIndex === -1) {
          return;
        }

        event.preventDefault();

        const nextIndex =
          event.key === "ArrowDown"
            ? (currentIndex + 1) % navigationButtons.length
            : (currentIndex - 1 + navigationButtons.length) % navigationButtons.length;

        navigationButtons[nextIndex]?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !allNotifications.length || !liveRegionRef.current) {
      return;
    }

    const topNotification = allNotifications[0];
    if (topNotification.id !== previousTopNotificationIdRef.current) {
      liveRegionRef.current.textContent = `New ${topNotification.priority} notification: ${topNotification.title}`;
      previousTopNotificationIdRef.current = topNotification.id;
    }
  }, [allNotifications, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50" aria-hidden={!open}>
      <button
        type="button"
        aria-label="Close notifications drawer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      />

      <div
        id={drawerId}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-stellar-border bg-stellar-dark/95 shadow-2xl shadow-black/40 transition-transform duration-300 sm:w-[24rem]"
      >
        <div className="border-b border-stellar-border bg-stellar-card/80 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stellar-text-primary">Notifications</h2>
              <p className="text-sm text-stellar-text-secondary">{unreadCount} unread</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-stellar-text-secondary transition hover:text-stellar-text-primary focus:outline-none focus:ring-2 focus:ring-stellar-blue"
              aria-label="Close notifications"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              className="rounded-md border border-stellar-border px-3 py-1.5 text-xs font-medium text-stellar-text-primary transition hover:border-stellar-blue disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-stellar-blue"
            >
              Mark all as read
            </button>
            <button
              type="button"
              onClick={clearReadNotifications}
              disabled={!hasReadNotifications}
              className="rounded-md border border-stellar-border px-3 py-1.5 text-xs font-medium text-stellar-text-primary transition hover:border-stellar-blue disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-stellar-blue"
            >
              Clear read
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-stellar-border pt-3">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="notifications-sound-toggle"
                className="text-xs text-stellar-text-secondary"
              >
                Audible alerts
              </label>
              <button
                id="notifications-sound-toggle"
                type="button"
                role="switch"
                aria-checked={soundEnabled}
                disabled={!notifier.soundSupported}
                onClick={() => {
                  // Arm audio in the same gesture, otherwise the browser keeps
                  // the AudioContext suspended and the first chime is silent.
                  notifier.enableSound();
                  setPreference("soundEnabled", !soundEnabled);
                }}
                className={`relative h-5 w-9 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-blue disabled:cursor-not-allowed disabled:opacity-40 ${
                  soundEnabled ? "bg-stellar-blue" : "bg-stellar-border"
                }`}
              >
                <span className="sr-only">
                  {soundEnabled ? "Audible alerts on" : "Audible alerts off"}
                </span>
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                    soundEnabled ? "translate-x-[1.125rem]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {notifier.soundSupported && soundEnabled && !notifier.soundUnlocked && (
              <p className="text-xs text-yellow-400">
                Tap the toggle once to arm sound — browsers block audio until you interact.
              </p>
            )}
            {!notifier.soundSupported && (
              <p className="text-xs text-stellar-text-secondary">
                Web Audio is unavailable in this browser, so audible alerts are disabled.
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="notifications-desktop-toggle"
                className="text-xs text-stellar-text-secondary"
              >
                Desktop notifications
              </label>
              <button
                id="notifications-desktop-toggle"
                type="button"
                role="switch"
                aria-checked={desktopNotificationsEnabled}
                disabled={!notifier.desktopSupported}
                onClick={() => {
                  if (!desktopNotificationsEnabled) {
                    // Only ask on the enabling gesture; browsers reject
                    // permission prompts that are not user-initiated.
                    void notifier.requestDesktopPermission();
                  }
                  setPreference("notificationsEnabled", !desktopNotificationsEnabled);
                }}
                className={`relative h-5 w-9 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-blue disabled:cursor-not-allowed disabled:opacity-40 ${
                  desktopNotificationsEnabled ? "bg-stellar-blue" : "bg-stellar-border"
                }`}
              >
                <span className="sr-only">
                  {desktopNotificationsEnabled
                    ? "Desktop notifications on"
                    : "Desktop notifications off"}
                </span>
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                    desktopNotificationsEnabled ? "translate-x-[1.125rem]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {notifier.desktopPermission === "denied" && (
              <p className="text-xs text-red-400">
                Browser notifications are blocked. Allow them in your browser site settings to
                receive alerts while this tab is in the background.
              </p>
            )}
          </div>
        </div>

        <p ref={liveRegionRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />

        <div className="flex-1 overflow-y-auto p-4">
          {!hasAnyNotifications && (
            <p className="rounded-lg border border-stellar-border bg-stellar-card/60 p-4 text-sm text-stellar-text-secondary">
              You have no notifications.
            </p>
          )}

          <div className="space-y-4">
            {NOTIFICATION_PRIORITY_ORDER.map((priority) => {
              const notificationsForPriority = groupedNotifications[priority];
              if (!notificationsForPriority.length) {
                return null;
              }

              return (
                <section key={priority} aria-label={`${priorityLabelMap[priority]} notifications`}>
                  <h3
                    className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] ${priorityTextColorMap[priority]}`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${priorityDotColorMap[priority]}`}
                      aria-hidden="true"
                    />
                    {priorityLabelMap[priority]}
                  </h3>
                  <ul className="space-y-2" role="list">
                    {notificationsForPriority
                      .slice()
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((notification) => (
                        <NotificationRow
                          key={notification.id}
                          notification={notification}
                          onMarkAsRead={markAsRead}
                        />
                      ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface NotificationRowProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
}

function NotificationRow({ notification, onMarkAsRead }: NotificationRowProps) {
  return (
    <li
      className={`rounded-xl border p-3 ${
        notification.read
          ? "border-stellar-border bg-stellar-card/50"
          : "border-stellar-blue/40 bg-stellar-blue/10"
      }`}
      role="listitem"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stellar-text-primary">{notification.title}</p>
          <p className="mt-1 text-sm text-stellar-text-secondary">{notification.message}</p>
          <p className="mt-2 text-xs text-stellar-text-secondary">
            {formatNotificationTime(notification.timestamp)}
          </p>
        </div>
        <button
          type="button"
          data-notification-item-action="mark-as-read"
          onClick={() => onMarkAsRead(notification.id)}
          disabled={notification.read}
          className="rounded-md border border-stellar-border px-2 py-1 text-xs font-medium text-stellar-text-primary transition hover:border-stellar-blue disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-stellar-blue"
          aria-label={`Mark ${notification.title} as read`}
        >
          Mark as read
        </button>
      </div>
    </li>
  );
}
