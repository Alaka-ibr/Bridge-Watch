import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAlertChime, CHIMES, isWebAudioSupported } from "./useAlertChime";

class FakeAudioParam {
  value = 0;
  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
}

class FakeOscillator {
  type = "sine";
  frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  startedAt = 0;
  stoppedAt = 0;
  disconnected = false;
  private ctx: FakeAudioContext;

  constructor(ctx: FakeAudioContext) {
    this.ctx = ctx;
  }
  connect() {
    return this;
  }
  disconnect() {
    this.disconnected = true;
  }
  start(at: number) {
    this.startedAt = at;
    this.ctx.started.push(this);
  }
  stop(at: number) {
    this.stoppedAt = at;
  }
}

class FakeGainNode {
  gain = new FakeAudioParam();
  disconnected = false;
  connect() {
    return this;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 10;
  destination = {} as AudioDestinationNode;
  started: FakeOscillator[] = [];
  resumes = 0;
  closed = 0;

  createOscillator() {
    return new FakeOscillator(this) as unknown as OscillatorNode;
  }
  createGain() {
    return new FakeGainNode() as unknown as GainNode;
  }
  resume() {
    this.resumes += 1;
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.closed += 1;
    this.state = "closed";
    return Promise.resolve();
  }
}

let contexts: FakeAudioContext[] = [];

function installAudio(state: AudioContextState = "running") {
  contexts = [];
  class Ctor {
    constructor() {
      const ctx = new FakeAudioContext();
      ctx.state = state;
      contexts.push(ctx);
      this.ctx = ctx;
    }
    ctx: FakeAudioContext;
    createOscillator() {
      return this.ctx.createOscillator();
    }
    createGain() {
      return this.ctx.createGain();
    }
    resume() {
      return this.ctx.resume();
    }
    close() {
      return this.ctx.close();
    }
    get currentTime() {
      return this.ctx.currentTime;
    }
    get destination() {
      return this.ctx.destination;
    }
    get state() {
      return this.ctx.state;
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = Ctor;
}

function uninstallAudio() {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
}

describe("useAlertChime", () => {
  beforeEach(() => {
    installAudio();
  });

  afterEach(() => {
    uninstallAudio();
    vi.restoreAllMocks();
  });

  it("reports support based on the Web Audio API", () => {
    expect(isWebAudioSupported()).toBe(true);
    const { result } = renderHook(() => useAlertChime(true));
    expect(result.current.supported).toBe(true);
  });

  it("reports no support when the browser lacks Web Audio", () => {
    uninstallAudio();
    const { result } = renderHook(() => useAlertChime(true));
    expect(result.current.supported).toBe(false);
  });

  it("plays one oscillator per note for a critical alert", () => {
    const { result } = renderHook(() => useAlertChime(true));

    act(() => {
      result.current.play("critical");
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0].started).toHaveLength(CHIMES.critical.notes.length);
  });

  it("plays a single blip for a high alert", () => {
    const { result } = renderHook(() => useAlertChime(true));

    act(() => {
      result.current.play("high");
    });

    expect(contexts[0].started).toHaveLength(1);
  });

  it("schedules notes sequentially on the audio clock", () => {
    const { result } = renderHook(() => useAlertChime(true));

    act(() => {
      result.current.play("critical");
    });

    const [first, second] = contexts[0].started;
    const firstDuration = CHIMES.critical.notes[0][1];
    expect(first.startedAt).toBe(contexts[0].currentTime);
    expect(second.startedAt).toBeGreaterThan(first.startedAt);
    expect(first.stoppedAt).toBeLessThanOrEqual(first.startedAt + firstDuration);
  });

  it("does nothing when sound is disabled", () => {
    const { result } = renderHook(() => useAlertChime(false));

    act(() => {
      result.current.play("critical");
    });

    expect(contexts).toHaveLength(0);
  });

  it("reuses a single AudioContext across alerts", () => {
    const { result } = renderHook(() => useAlertChime(true));

    act(() => {
      result.current.play("high");
    });
    act(() => {
      result.current.play("critical");
    });

    expect(contexts).toHaveLength(1);
  });

  it("resumes a suspended context instead of firing into silence", () => {
    installAudio("suspended");
    const { result } = renderHook(() => useAlertChime(true));

    act(() => {
      result.current.play("critical");
    });

    expect(contexts[0].resumes).toBe(1);
    expect(contexts[0].started).toHaveLength(0);
  });

  it("unlocks the context from a user gesture", async () => {
    installAudio("suspended");
    const { result } = renderHook(() => useAlertChime(true));

    await act(async () => {
      result.current.unlock();
    });

    expect(result.current.unlocked).toBe(true);
    expect(contexts[0].resumes).toBe(1);
  });

  it("closes the context on unmount", () => {
    const { result, unmount } = renderHook(() => useAlertChime(true));
    // The context is created lazily, so create one before unmounting.
    act(() => {
      result.current.play("high");
    });
    act(() => {
      unmount();
    });
    expect(contexts[0].closed).toBe(1);
  });
});
