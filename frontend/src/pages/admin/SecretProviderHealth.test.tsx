import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SecretProviderHealth from "./SecretProviderHealth";

describe("SecretProviderHealth Admin Page (#1190)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/summary")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              totalProviders: 3,
              healthyCount: 3,
              degradedCount: 0,
              unhealthyCount: 0,
              primaryProviderHealthy: true,
              primaryProviderId: "sp_vault_primary",
              activeFailover: false,
              averageLatencyMs: 18,
              lastCheckTimestamp: new Date().toISOString(),
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            providers: [
              {
                id: "sp_vault_primary",
                provider_type: "vault",
                name: "Production Vault Cluster",
                endpoint: "https://vault.internal:8200",
                status: "healthy",
                is_primary: true,
                consecutive_failures: 0,
                last_latency_ms: 18,
              },
            ],
          }),
      });
    });
  });

  it("renders page header and healthy status metrics", async () => {
    render(
      <BrowserRouter>
        <SecretProviderHealth />
      </BrowserRouter>
    );

    expect(screen.getByText("Secret Provider Health Checks")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Production Vault Cluster")).toBeInTheDocument();
    });
  });

  it("triggers global probe when button clicked", async () => {
    render(
      <BrowserRouter>
        <SecretProviderHealth />
      </BrowserRouter>
    );

    const probeBtn = screen.getByText("⚡ Run Global Health Probe");
    fireEvent.click(probeBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/secret-providers/check-all", {
        method: "POST",
      });
    });
  });
});
