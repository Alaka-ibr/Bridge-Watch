import "@testing-library/jest-dom/vitest";
import { expect, afterEach, beforeAll, afterAll } from "vitest";
import { cleanup } from "@testing-library/react";
import * as axeMatchers from "vitest-axe/matchers";
import { server } from "./mocks/server";

// Extend Vitest matchers
expect.extend(axeMatchers);

// Browser observer stubs for jsdom
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback?: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    if (callback) {
      setTimeout(() => {
        callback([
          {
            isIntersecting: true,
            intersectionRatio: 1,
            target: document.createElement("div"),
          },
        ]);
      }, 0);
    }
  }
}
global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// MSW Lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
