import { useEffect, useReducer, useRef, useState } from "react";

/** Forces a re-render when a ref-backed value needs to reach the UI. */
function useReducerTick(): [number, () => void] {
  return useReducer((tick: number) => tick + 1, 0);
}
import {
  PROFILE_SYNC_USER_ID_KEY,
  type ThemeMode,
} from "../theme/themeStorage";

export type ThemeSyncStatus = "idle" | "syncing" | "synced" | "error" | "disabled";

export interface UseThemeProfileSyncOptions {
  mode: ThemeMode;
  highContrast: boolean;
  /** Debounce so dragging through theme options is not one request per click. */
  debounceMs?: number;
}

export interface UseThemeProfileSyncResult {
  status: ThemeSyncStatus;
  /** Last sync failure, if any, for surfacing in the UI. */
  error: string | null;
  /** Set a user id to opt this device into cross-device theme sync. */
  setSyncUserId: (userId: string | null) => void;
  /** Force an immediate sync, e.g. when leaving the settings page. */
  flush: () => void;
}

function readSyncUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PROFILE_SYNC_USER_ID_KEY);
  } catch {
    return null;
  }
}

function writeSyncUserId(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      window.localStorage.setItem(PROFILE_SYNC_USER_ID_KEY, userId);
    } else {
      window.localStorage.removeItem(PROFILE_SYNC_USER_ID_KEY);
    }
  } catch {
    // ignore
  }
}

function getApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
}

/**
 * Syncs the theme mode and high-contrast flag to
 * `PUT /api/v1/preferences/:userId/display/:key` so preferences follow the
 * operator across devices.
 *
 * Sync is opt-in per device via a locally stored user id. When no id is
 * configured the theme still works, it is simply local-only — the app has no
 * built-in auth, so assuming an identity would be wrong.
 */
export function useThemeProfileSync({
  mode,
  highContrast,
  debounceMs = 800,
}: UseThemeProfileSyncOptions): UseThemeProfileSyncResult {
  const statusRef = useRef<ThemeSyncStatus>("idle");
  const errorRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userId, setUserId] = useState<string | null>(readSyncUserId);

  // Re-render to reflect status changes without re-triggering the sync effect.
  const [, forceRender] = useReducerTick();

  const setStatus = (status: ThemeSyncStatus, error: string | null = null) => {
    statusRef.current = status;
    errorRef.current = error;
    forceRender();
  };

  const push = async (target: string | null, settings: Record<string, unknown>) => {
    if (!target) {
      setStatus("disabled");
      return;
    }

    setStatus("syncing");
    try {
      const base = getApiBase();
      // The endpoint takes one key per call, so issue them concurrently.
      const results = await Promise.all(
        Object.entries(settings).map(([key, value]) =>
          fetch(`${base}/api/v1/preferences/${encodeURIComponent(target)}/display/${key}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value }),
          })
        )
      );

      const failed = results.find((response) => !response.ok);
      if (failed) {
        setStatus("error", `Preference sync failed (${failed.status})`);
        return;
      }
      setStatus("synced");
    } catch (err) {
      setStatus(
        "error",
        err instanceof Error ? err.message : "Preference sync failed"
      );
    }
  };

  const schedule = (target: string | null, settings: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void push(target, settings);
    }, debounceMs);
  };

  useEffect(() => {
    schedule(userId, { theme: mode, highContrast });
  }, [userId, mode, highContrast]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    status: statusRef.current,
    error: errorRef.current,
    setSyncUserId: (next: string | null) => {
      writeSyncUserId(next);
      setUserId(next);
    },
    flush: () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void push(userId, { theme: mode, highContrast });
    },
  };
}
