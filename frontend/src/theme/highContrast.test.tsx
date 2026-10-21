import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ThemeProvider from "./ThemeProvider";
import ThemeToggle from "../components/ThemeToggle";
import {
  HIGH_CONTRAST_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  normalizeMode,
  readHighContrastPreference,
  resolveTheme,
} from "./themeStorage";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

describe("themeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
    document.documentElement.classList.remove("dark");
  });

  it("normalizes only known modes", () => {
    expect(normalizeMode("light")).toBe("light");
    expect(normalizeMode("dark")).toBe("dark");
    expect(normalizeMode("system")).toBe("system");
    expect(normalizeMode("nonsense")).toBe("system");
    expect(normalizeMode(null)).toBe("system");
  });

  it("resolves system mode to the current system theme", () => {
    expect(["light", "dark"]).toContain(resolveTheme("system"));
  });

  it("sets data-contrast only when high contrast is on", () => {
    applyThemeToDocument("dark", true);
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");

    applyThemeToDocument("dark", false);
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  });

  it("keeps the theme class and attributes in sync", () => {
    applyThemeToDocument("dark", false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyThemeToDocument("light", false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("reads the persisted high contrast flag", () => {
    expect(readHighContrastPreference()).toBe(false);
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "true");
    expect(readHighContrastPreference()).toBe(true);
  });
});

describe("ThemeToggle high contrast", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-contrast");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a high contrast switch", () => {
    renderToggle();
    expect(screen.getByRole("switch", { name: /High contrast mode/i })).toBeInTheDocument();
  });

  it("toggles the data-contrast attribute", async () => {
    renderToggle();

    const toggle = screen.getByRole("switch", { name: /High contrast mode/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-contrast")).toBe("high")
    );
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("persists the high contrast choice", async () => {
    renderToggle();

    fireEvent.click(screen.getByRole("switch", { name: /High contrast mode/i }));

    await waitFor(() =>
      expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe("true")
    );
  });

  it("restores a persisted high contrast preference on mount", () => {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "true");
    renderToggle();
    expect(screen.getByRole("switch", { name: /High contrast mode/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("leaves the existing light/dark toggle working", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderToggle();

    const themeSwitch = screen.getByRole("switch", { name: /Switch to light theme/i });
    expect(themeSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("reports local-only sync when no user id is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderToggle();
    fireEvent.click(screen.getByRole("button", { name: /Sync theme across devices/i }));

    await waitFor(() => expect(screen.getByText(/Local only/i)).toBeInTheDocument());
    // No user id means the hook must not hit the network at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushes theme and high contrast to the profile once a user id is set", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    localStorage.setItem("bridge-watch:profile-sync-user-id:v1", "operator-1");

    renderToggle();
    fireEvent.click(screen.getByRole("switch", { name: /High contrast mode/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });

    const called = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.includes("/preferences/operator-1/display/theme"))).toBe(true);
    expect(called.some((url) => url.includes("/preferences/operator-1/display/highContrast"))).toBe(
      true
    );
  });
});
