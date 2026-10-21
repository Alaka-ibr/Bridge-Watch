import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsDrawer from "./NotificationsDrawer";
import { useNotificationStore } from "../stores/notificationStore";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";

const enableSoundMock = vi.fn();
const requestDesktopPermissionMock = vi.fn(async () => {});

let desktopPermission: "granted" | "denied" | "default" = "granted";
let soundUnlocked = true;
let soundSupported = true;

vi.mock("../hooks/useAlertChime", () => ({
  useAlertChime: () => ({
    supported: soundSupported,
    unlocked: soundUnlocked,
    unlock: enableSoundMock,
    play: vi.fn(),
  }),
  isWebAudioSupported: () => soundSupported,
}));

vi.mock("../hooks/useDesktopNotifications", () => ({
  useDesktopNotifications: () => ({
    support: desktopPermission,
    requestPermission: requestDesktopPermissionMock,
    notifyInBackground: vi.fn(() => false),
  }),
  getDesktopPermission: () => desktopPermission,
  getDesktopNotificationSupport: () => ({}),
}));

function resetStores() {
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useUserPreferencesStore.setState(useUserPreferencesStore.getInitialState(), true);
}

function renderDrawer() {
  return render(
    <NotificationsDrawer open drawerId="test-drawer" onClose={vi.fn()} />
  );
}

describe("NotificationsDrawer alert controls", () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    enableSoundMock.mockClear();
    requestDesktopPermissionMock.mockClear();
    desktopPermission = "granted";
    soundUnlocked = true;
    soundSupported = true;
  });

  it("renders an audible alerts switch", () => {
    renderDrawer();
    expect(screen.getByRole("switch", { name: /Audible alerts/i })).toBeInTheDocument();
  });

  it("renders a desktop notifications switch", () => {
    renderDrawer();
    expect(
      screen.getByRole("switch", { name: /Desktop notifications/i })
    ).toBeInTheDocument();
  });

  it("reflects the persisted sound preference", () => {
    useUserPreferencesStore.setState({ soundEnabled: true });
    renderDrawer();
    expect(screen.getByRole("switch", { name: /Audible alerts/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("toggles the sound preference and arms audio in the same gesture", () => {
    useUserPreferencesStore.setState({ soundEnabled: false });
    renderDrawer();

    fireEvent.click(screen.getByRole("switch", { name: /Audible alerts/i }));

    expect(enableSoundMock).toHaveBeenCalled();
    expect(useUserPreferencesStore.getState().soundEnabled).toBe(true);
  });

  it("requests notification permission when enabling desktop alerts", async () => {
    useUserPreferencesStore.setState({ notificationsEnabled: false });
    renderDrawer();

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /Desktop notifications/i }));
    });

    expect(requestDesktopPermissionMock).toHaveBeenCalled();
    expect(useUserPreferencesStore.getState().notificationsEnabled).toBe(true);
  });

  it("does not re-request permission when disabling desktop alerts", async () => {
    useUserPreferencesStore.setState({ notificationsEnabled: true });
    renderDrawer();

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /Desktop notifications/i }));
    });

    expect(requestDesktopPermissionMock).not.toHaveBeenCalled();
    expect(useUserPreferencesStore.getState().notificationsEnabled).toBe(false);
  });

  it("explains how to unblock notifications when permission is denied", () => {
    desktopPermission = "denied";
    renderDrawer();
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });

  it("prompts the operator to arm sound before the first chime", () => {
    soundUnlocked = false;
    useUserPreferencesStore.setState({ soundEnabled: true });
    renderDrawer();
    expect(screen.getByText(/block audio until you interact/i)).toBeInTheDocument();
  });

  it("hides the arm-sound prompt once audio is unlocked", () => {
    useUserPreferencesStore.setState({ soundEnabled: true });
    renderDrawer();
    expect(screen.queryByText(/block audio until you interact/i)).not.toBeInTheDocument();
  });

  it("explains the missing API when Web Audio is unavailable", () => {
    soundSupported = false;
    renderDrawer();
    expect(screen.getByRole("switch", { name: /Audible alerts/i })).toBeDisabled();
    expect(screen.getByText(/Web Audio is unavailable/i)).toBeInTheDocument();
  });

  it("keeps the existing notification list and actions working", () => {
    useNotificationStore.getState().addNotification({
      id: "n-1",
      type: "system",
      priority: "critical",
      title: "Circuit breaker tripped",
      message: "Reserve mismatch detected",
      timestamp: 5,
    });

    renderDrawer();

    expect(screen.getByText("Circuit breaker tripped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mark all as read/i })).toBeInTheDocument();
  });

  it("closes via the escape key without breaking on the new controls", async () => {
    const onClose = vi.fn();
    render(
      <NotificationsDrawer open drawerId="test-drawer" onClose={onClose} />
    );

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
