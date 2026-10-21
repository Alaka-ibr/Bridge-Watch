import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BridgeWatchContractSdk } from "./client";

const testConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  apiUrl: "https://api.bridge-watch.test",
} as never;

const VALID_TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Headers {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return new Headers(init.headers);
}

describe("SDK traceparent propagation", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds a traceparent to outgoing compatibility requests", async () => {
    const fetchMock = stubFetch();
    const sdk = new BridgeWatchContractSdk(testConfig);

    await sdk.getApiContract();

    expect(sentHeaders(fetchMock).get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/
    );
  });

  it("keeps the existing API version headers intact", async () => {
    const fetchMock = stubFetch();
    const sdk = new BridgeWatchContractSdk(testConfig);

    await sdk.getApiContract();

    const headers = sentHeaders(fetchMock);
    expect(headers.get("X-API-Version")).toBe("v1");
    expect(headers.get("Accept")).toBe("application/vnd.bridge-watch.v1+json");
  });

  it("continues the trace of a supplied inbound traceparent", async () => {
    const fetchMock = stubFetch();
    const sdk = new BridgeWatchContractSdk({
      ...(testConfig as object),
      tracing: { traceparent: VALID_TRACEPARENT },
    } as never);

    await sdk.getApiContract();

    const header = sentHeaders(fetchMock).get("traceparent")!;
    expect(header).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("forwards a tracestate alongside the traceparent", async () => {
    const fetchMock = stubFetch();
    const sdk = new BridgeWatchContractSdk({
      ...(testConfig as object),
      tracing: { traceparent: VALID_TRACEPARENT, tracestate: "vendor=abc" },
    } as never);

    await sdk.getApiContract();

    const headers = sentHeaders(fetchMock);
    expect(headers.get("tracestate")).toBe("vendor=abc");
  });

  it("uses a fresh trace id when startNewTrace is set", async () => {
    const fetchMock = stubFetch();
    const sdk = new BridgeWatchContractSdk({
      ...(testConfig as object),
      tracing: { traceparent: VALID_TRACEPARENT, startNewTrace: true },
    } as never);

    await sdk.getApiContract();

    expect(sentHeaders(fetchMock).get("traceparent")).not.toContain(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
  });

  it("mints a new span for every request within the same trace", async () => {
    const fetchMock = stubFetch();
    const sdk = new BridgeWatchContractSdk({
      ...(testConfig as object),
      tracing: { traceparent: VALID_TRACEPARENT },
    } as never);

    await sdk.getApiContract();
    await sdk.getApiCapabilities();

    const traceparents = fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      return new Headers(init.headers).get("traceparent");
    });

    const traceIds = new Set(
      traceparents.map((value) => value!.split("-")[1])
    );
    const spanIds = new Set(
      traceparents.map((value) => value!.split("-")[2])
    );

    // Same trace, distinct spans: that is what links the backend's work back
    // to the caller's trace.
    expect(traceIds.size).toBe(1);
    expect(spanIds.size).toBe(2);
  });

  it("ignores a malformed inbound traceparent rather than propagating it", async () => {
    const fetchMock = stubFetch();
    const sdk = new BridgeWatchContractSdk({
      ...(testConfig as object),
      tracing: { traceparent: "totally-invalid" },
    } as never);

    await sdk.getApiContract();

    expect(sentHeaders(fetchMock).get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/
    );
  });
});
