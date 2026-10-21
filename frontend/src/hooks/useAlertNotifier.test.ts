import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAlertNotifier, chimeForPriority } from "./useAlertNotifier";
import { useNotificationStore } from "../stores/notificationStore";

const playMock = vi.fn();
const notifyMock = vi.fn(() => true);
const unlockMock = vi.fn();
const requestPermissionMock = vi.fn(async () => "granted");

let permission: NotificationPermission = "granted";

class FakeNotification {
  static instances: FakeNotification[] = [];
  onclose: (() => void) | null = null;
  closed = false;
  constructor(
    public title: string,
    public options?: NotificationOptions
  ) {
    FakeNotification.instances.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => "granted");
}

vi.mock("./useAlertChime", () => ({
  useAlertChime: () => ({
    supported: true,
    unlocked: true,
    unlock: unlockMock,
    play: playMock,
  }),
  isWebAudioSupported: () => true,
}));

vi.mock("./useDesktopNotifications", () => ({
  useDesktopNotifications: () => ({
    support: permission === "granted" ? "granted" : permission,
    requestPermission: requestPermissionMock,
    notifyInBackground: notifyMock,
  }),
  getDesktopPermission: () => permission,
  getDesktopNotificationSupport: () => new FakeNotification("probe"),
}));

function resetStore() {
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
}

function addAlert(priority: "critical" | "high" | "medium" | "low", id: string) {
  useNotificationStore.getState().addNotification({
    id,
    type: "system",
    priority,
    title: `${priority} alert`,
    message: `${priority} body`,
  });
}

describe("chimeForPriority", () => {
  it("maps alert priorities to chimes", () => {
    expect(chimeForPriority("critical")).toBe("critical");
    expect(chimeForPriority("high")).toBe("high");
  });

  it("returns null for priorities that should stay silent", () => {
    expect(chimeForPriority("medium")).toBeNull();
    expect(chimeForPriority("low")).toBeNull();
  });
});

describe("useAlertNotifier", () => {
  beforeEach(() => {
    resetStore();
    playMock.mockClear();
    notifyMock.mockClear();
    unlockMock.mockClear();
    notifyMock.mockReturnValue(true);
    permission = "granted";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not replay alerts that already existed on mount", () => {
    addAlert("critical", "existing-1");
    const { rerender } = renderHook(() =>
      useAlertNotifier({ soundEnabled: true, desktopEnabled: true })
    );

    // A re-render must not treat the seeded notification as new.
    rerender();
    rerender();

    expect(playMock).not.toHaveBeenCalled();
  });

  it("chimes when a new critical alert arrives", () => {
    const { rerender } = renderHook(() =>
      useAlertNotifier({ soundEnabled: true, desktopEnabled: true })
    );

    act(() => {
      addAlert("critical", "new-critical");
    });
    rerender();

    expect(playMock).toHaveBeenCalledWith("critical");
  });

  it("chimes when a new high alert arrives", () => {
    const { rerender } = renderHook(() =>
      useAlertNotifier({ soundEnabled: true, desktopEnabled: true })
    );

    act(() => {
      addAlert("high", "new-high");
    });
    rerender();

    expect(playMock).toHaveBeenCalledWith("high");
  });

  it("stays silent for medium and low alerts", () => {
    const { rerender } = renderHook(() =>
      useAlertNotifier({ soundEnabled: true, desktopEnabled: true })
    );

    act(() => {
      addAlert("medium", "new-medium");
    });
    act(() => {
      addAlert("low", "new-low");
    });
    rerender();

    expect(playMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("alerts once per notification, not on every re-render", () => {
    const { rerender } = renderHook(() =>
      useAlertNotifier({ soundEnabled: true, desktopEnabled: true })
    );

    act(() => {
      addAlert("critical", "once-only");
    });
    rerender();
    rerender();
    rerender();

    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it("forwards the alert to the desktop notifier", () => {
    const { rerender } = renderHook(() =>
      useAlertNotifier({ soundEnabled: true, desktopEnabled: true })
    );

    act(() => {
      addAlert("critical", "desktop-1");
    });
    rerender();

    expect(notifyMock).toHaveBeenCalledWith({
      title: "critical alert",
      body: "critical body",
      tag: "desktop-1",
    });
  });

  it("exposes support and unlock callbacks", async () => {
    const { result } = renderHook(() =>
      useAlertNotifier({ soundEnabled: true, desktopEnabled: true })
    );

    expect(result.current.soundSupported).toBe(true);
    expect(result.current.desktopSupported).toBe(true);

    act(() => {
      result.current.enableSound();
    });
    expect(unlockMock).toHaveBeenCalled();

    await act(async () => {
      await result.current.requestDesktopPermission();
    });
    expect(requestPermissionMock).toHaveBeenCalled();
  });
});
