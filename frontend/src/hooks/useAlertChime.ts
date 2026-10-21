import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Chime definitions per alert priority.
 *
 * Critical and high use different shapes so an operator can tell them apart
 * without looking: critical is a descending two-tone siren, high is a single
 * short blip.
 */
export type ChimeName = "critical" | "high";

interface ChimeSpec {
  /** [frequencyHz, durationSeconds] pairs played in sequence */
  notes: Array<[number, number]>;
  /** Seconds of silence between successive notes */
  gap: number;
  peakGain: number;
}

export const CHIMES: Record<ChimeName, ChimeSpec> = {
  critical: {
    notes: [
      [880, 0.18],
      [660, 0.18],
      [880, 0.18],
      [660, 0.26],
    ],
    gap: 0.02,
    peakGain: 0.28,
  },
  high: {
    notes: [[740, 0.16]],
    gap: 0,
    peakGain: 0.2,
  },
};

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Web Audio is unavailable in some browsers and in test environments. */
export function isWebAudioSupported(): boolean {
  return getAudioContextCtor() !== null;
}

export interface UseAlertChimeResult {
  /** True when this browser exposes the Web Audio API. */
  supported: boolean;
  /**
   * True once the AudioContext is running. Browsers keep it suspended until a
   * user gesture, so the UI can nudge the operator to tap once to arm sound.
   */
  unlocked: boolean;
  /**
   * Create/resume the AudioContext. Call from a user gesture handler, or the
   * context stays suspended and the chime is silent.
   */
  unlock: () => void;
  /** Play the chime for a priority. No-op when disabled or unsupported. */
  play: (chime: ChimeName) => void;
}

/**
 * Plays alert chimes through the Web Audio API.
 *
 * One AudioContext is created lazily and reused, since browsers cap how many
 * a page may hold. Oscillators are built per note and disconnected on `ended`
 * so nodes do not accumulate over a long shift.
 */
export function useAlertChime(enabled: boolean): UseAlertChimeResult {
  const contextRef = useRef<AudioContext | null>(null);
  const [supported] = useState(() => isWebAudioSupported());
  const [unlocked, setUnlocked] = useState(false);

  const ensureContext = useCallback((): AudioContext | null => {
    if (!enabled) return null;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;

    if (!contextRef.current) {
      try {
        contextRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    return contextRef.current;
  }, [enabled]);

  const unlock = useCallback(() => {
    const context = ensureContext();
    if (!context) return;

    if (context.state === "suspended") {
      void context
        .resume?.()
        .then(() => setUnlocked(true))
        .catch(() => setUnlocked(false));
      return;
    }
    setUnlocked(context.state === "running");
  }, [ensureContext]);

  // Release the context on unmount rather than leaking it for the page lifetime.
  useEffect(() => {
    return () => {
      const context = contextRef.current;
      contextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close?.().catch(() => undefined);
      }
    };
  }, []);

  const play = useCallback(
    (chime: ChimeName) => {
      if (!enabled) return;
      const context = ensureContext();
      if (!context) return;

      // A suspended context cannot make sound; ask to resume and skip this
      // note rather than firing into a dead node.
      if (context.state === "suspended") {
        void context
          .resume?.()
          .then(() => setUnlocked(true))
          .catch(() => undefined);
        return;
      }

      const spec = CHIMES[chime];
      let startAt = context.currentTime;

      for (const [frequency, duration] of spec.notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt);

        // Short attack/decay envelope avoids the click a hard gate produces.
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(spec.peakGain, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration);

        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };

        startAt += duration + spec.gap;
      }
    },
    [enabled, ensureContext]
  );

  return { supported, unlocked, unlock, play };
}
