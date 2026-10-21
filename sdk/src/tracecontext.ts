/**
 * W3C Trace Context propagation for SDK requests.
 *
 * Implements the `traceparent` / `tracestate` formats from the W3C Trace
 * Context recommendation so API calls made through the SDK carry the caller's
 * trace into the backend, where it can be correlated with database spans.
 *
 * @see https://www.w3.org/TR/trace-context/
 */

/** `00-<32 hex trace-id>-<16 hex span-id>-<2 hex flags>` */
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** All-zero trace-id and span-id are invalid per the spec. */
const INVALID_TRACE_ID = "0".repeat(32);
const INVALID_SPAN_ID = "0".repeat(16);

export interface TraceparentParts {
  version: string;
  traceId: string;
  spanId: string;
  sampled: boolean;
}

/** True when a 32-char trace id contains at least one non-zero hex digit. */
export function isValidTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/.test(traceId) && traceId !== INVALID_TRACE_ID;
}

/** True when a 16-char span id contains at least one non-zero hex digit. */
export function isValidSpanId(spanId: string): boolean {
  return /^[0-9a-f]{16}$/.test(spanId) && spanId !== INVALID_SPAN_ID;
}

/** Parse a `traceparent` header value, returning null when malformed. */
export function parseTraceparent(value: string | null | undefined): TraceparentParts | null {
  if (!value) return null;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, traceId, spanId, flags] = match;
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) return null;

  return {
    version: "00",
    traceId,
    spanId,
    // Only the low bit of the flags byte is defined.
    sampled: (parseInt(flags, 16) & 0x01) === 0x01,
  };
}

/** Serialise trace context back into a `traceparent` header value. */
export function formatTraceparent(parts: {
  traceId: string;
  spanId: string;
  sampled: boolean;
}): string {
  return `00-${parts.traceId}-${parts.spanId}-${parts.sampled ? "01" : "00"}`;
}

/**
 * Produce 16 random bytes as lowercase hex.
 *
 * Uses `crypto.getRandomValues` when available and falls back to `Math.random`
 * so the SDK still works on runtimes without Web Crypto. Span ids only need to
 * be unique within a trace, not unguessable.
 */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;

  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isValidTracestate(value: string | null | undefined): value is string {
  if (!value) return false;
  // W3C limits tracestate to 32 list-members of 256 chars each.
  if (value.length > 512) return false;
  return value
    .split(",")
    .every((member) => member.trim().length > 0 && member.length <= 256);
}

export interface TraceContextOptions {
  /**
   * An inbound `traceparent` (typically from the incoming HTTP request) to
   * continue. When absent a new root trace is started.
   */
  traceparent?: string | null;
  /** Optional inbound `tracestate` to forward. */
  tracestate?: string | null;
  /**
   * When true, a new root trace is started even if a `traceparent` is
   * supplied. Use this to deliberately break the trace at the SDK boundary.
   */
  startNewTrace?: boolean;
  /** Force the sampled flag instead of honouring the inbound value. */
  sampled?: boolean;
}

/**
 * Resolve the trace context to attach to an outgoing request.
 *
 * When a valid inbound `traceparent` is present, a **new span id** is minted
 * for this request while keeping the same trace id, which is what links the
 * backend's work to the caller's trace.
 */
export function resolveTraceContext(
  options: TraceContextOptions = {},
): { traceparent: string; tracestate?: string } {
  const inbound = options.startNewTrace
    ? null
    : parseTraceparent(options.traceparent);

  const traceId = inbound?.traceId ?? randomHex(16);
  const spanId = randomHex(8);
  const sampled = options.sampled ?? inbound?.sampled ?? true;

  const result: { traceparent: string; tracestate?: string } = {
    traceparent: formatTraceparent({ traceId, spanId, sampled }),
  };

  // Only forward tracestate alongside a valid traceparent; the spec ties the
  // two together and a stale tracestate with a new trace is meaningless.
  if (inbound && isValidTracestate(options.tracestate)) {
    result.tracestate = options.tracestate as string;
  }

  return result;
}

/**
 * Apply trace headers to an outgoing request's header set.
 *
 * An existing `traceparent` is left untouched: a caller that already set the
 * header (for example from a live OpenTelemetry context) knows better than we
 * do. Otherwise a context is resolved, which continues the inbound trace when
 * one was supplied and starts a fresh root trace when it was not.
 */
export function injectTraceHeaders(
  headers: Headers,
  options: TraceContextOptions = {},
): Headers {
  if (!headers.has("traceparent")) {
    const context = resolveTraceContext(options);
    headers.set("traceparent", context.traceparent);
    if (context.tracestate) {
      headers.set("tracestate", context.tracestate);
    }
  }

  // Never forward tracestate on its own: it is meaningless without the
  // traceparent it belongs to, and the spec pairs the two.
  if (isValidTracestate(options.tracestate) && !headers.has("tracestate")) {
    headers.set("tracestate", options.tracestate as string);
  }

  return headers;
}
