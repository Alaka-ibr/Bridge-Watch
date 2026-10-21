import { describe, it, expect } from "vitest";
import {
  parseTraceparent,
  formatTraceparent,
  isValidTraceId,
  isValidSpanId,
  randomHex,
  resolveTraceContext,
  injectTraceHeaders,
} from "./tracecontext";

const VALID_TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("parseTraceparent", () => {
  it("parses a valid header", () => {
    expect(parseTraceparent(VALID_TRACEPARENT)).toEqual({
      version: "00",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    });
  });

  it("reads the sampled flag from the low bit", () => {
    expect(parseTraceparent(VALID_TRACEPARENT)?.sampled).toBe(true);
    expect(
      parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")?.sampled
    ).toBe(false);
  });

  it("ignores other flag bits", () => {
    // 0xfe has the low bit clear, so the trace is not sampled.
    expect(
      parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-fe")?.sampled
    ).toBe(false);
  });

  it("rejects an all-zero trace id", () => {
    expect(
      parseTraceparent(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`)
    ).toBeNull();
  });

  it("rejects an all-zero span id", () => {
    expect(
      parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01")
    ).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent("")).toBeNull();
    expect(parseTraceparent("garbage")).toBeNull();
    expect(parseTraceparent("00-tooshort-00f067aa0ba902b7-01")).toBeNull();
  });

  it("rejects uppercase hex, which the spec forbids", () => {
    expect(
      parseTraceparent("00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01")
    ).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTraceparent(`  ${VALID_TRACEPARENT}  `)).not.toBeNull();
  });
});

describe("formatTraceparent", () => {
  it("round-trips through parse", () => {
    const parts = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    };
    expect(parseTraceparent(formatTraceparent(parts))).toMatchObject(parts);
  });

  it("emits 00 for unsampled", () => {
    expect(formatTraceparent({ traceId: "a".repeat(32), spanId: "b".repeat(16), sampled: false })).toMatch(
      /-00$/
    );
  });
});

describe("id validation", () => {
  it("requires the exact hex length", () => {
    expect(isValidTraceId("a".repeat(32))).toBe(true);
    expect(isValidTraceId("a".repeat(31))).toBe(false);
    expect(isValidSpanId("b".repeat(16))).toBe(true);
    expect(isValidSpanId("b".repeat(15))).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidTraceId("z".repeat(32))).toBe(false);
    expect(isValidSpanId("z".repeat(16))).toBe(false);
  });
});

describe("randomHex", () => {
  it("returns the requested number of bytes as hex", () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not repeat itself", () => {
    const values = new Set(Array.from({ length: 50 }, () => randomHex(8)));
    expect(values.size).toBe(50);
  });
});

describe("resolveTraceContext", () => {
  it("starts a new trace when no parent is supplied", () => {
    const context = resolveTraceContext();
    expect(parseTraceparent(context.traceparent)).not.toBeNull();
  });

  it("keeps the parent trace id and mints a new span id", () => {
    const parent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const context = resolveTraceContext({ traceparent: parent });
    const parsed = parseTraceparent(context.traceparent)!;

    expect(parsed.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(parsed.spanId).not.toBe("00f067aa0ba902b7");
  });

  it("inherits the sampled flag from the parent", () => {
    const parent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00";
    expect(parseTraceparent(resolveTraceContext({ traceparent: parent }).traceparent)?.sampled).toBe(
      false
    );
  });

  it("lets the caller force the sampled flag", () => {
    const context = resolveTraceContext({ traceparent: VALID_TRACEPARENT, sampled: false });
    expect(parseTraceparent(context.traceparent)?.sampled).toBe(false);
  });

  it("starts a new trace when asked to break the chain", () => {
    const context = resolveTraceContext({ traceparent: VALID_TRACEPARENT, startNewTrace: true });
    expect(parseTraceparent(context.traceparent)?.traceId).not.toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
  });

  it("forwards a valid tracestate alongside the parent", () => {
    const context = resolveTraceContext({
      traceparent: VALID_TRACEPARENT,
      tracestate: "vendor=value",
    });
    expect(context.tracestate).toBe("vendor=value");
  });

  it("drops tracestate when there is no valid parent", () => {
    const context = resolveTraceContext({ tracestate: "vendor=value" });
    expect(context.tracestate).toBeUndefined();
  });

  it("drops an invalid tracestate", () => {
    const context = resolveTraceContext({
      traceparent: VALID_TRACEPARENT,
      tracestate: "x".repeat(600),
    });
    expect(context.tracestate).toBeUndefined();
  });

  it("mints a distinct span id per call", () => {
    const spanIds = new Set(
      Array.from({ length: 20 }, () =>
        parseTraceparent(resolveTraceContext({ traceparent: VALID_TRACEPARENT }).traceparent)!
          .spanId
      )
    );
    expect(spanIds.size).toBe(20);
  });
});

describe("injectTraceHeaders", () => {
  it("adds a traceparent to an empty header set", () => {
    const headers = injectTraceHeaders(new Headers());
    expect(headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/
    );
  });

  it("does not overwrite a traceparent the caller already set", () => {
    const headers = new Headers({ traceparent: VALID_TRACEPARENT });
    injectTraceHeaders(headers, { startNewTrace: true });
    expect(headers.get("traceparent")).toBe(VALID_TRACEPARENT);
  });

  it("preserves unrelated headers", () => {
    const headers = new Headers({ "X-API-Version": "v1" });
    injectTraceHeaders(headers);
    expect(headers.get("X-API-Version")).toBe("v1");
    expect(headers.get("traceparent")).not.toBeNull();
  });

  it("keeps the parent trace id but mints a fresh span for the request", () => {
    const headers = injectTraceHeaders(new Headers(), { traceparent: VALID_TRACEPARENT });
    const parsed = parseTraceparent(headers.get("traceparent"))!;

    expect(parsed.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    // A new span is what makes this request visible as its own span in the
    // backend's trace, so it must differ from the caller's span.
    expect(parsed.spanId).not.toBe("00f067aa0ba902b7");
  });

  it("breaks the chain when startNewTrace is requested", () => {
    const headers = injectTraceHeaders(new Headers(), {
      traceparent: VALID_TRACEPARENT,
      startNewTrace: true,
    });
    expect(parseTraceparent(headers.get("traceparent"))?.traceId).not.toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
  });

  it("replaces a malformed inbound parent with a fresh trace", () => {
    const headers = injectTraceHeaders(new Headers(), { traceparent: "not-a-traceparent" });
    expect(parseTraceparent(headers.get("traceparent"))).not.toBeNull();
  });

  it("forwards a valid tracestate", () => {
    const headers = injectTraceHeaders(new Headers(), {
      traceparent: VALID_TRACEPARENT,
      tracestate: "vendor=value",
    });
    expect(headers.get("tracestate")).toBe("vendor=value");
  });
});
