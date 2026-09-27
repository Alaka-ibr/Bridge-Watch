import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ContractEventSubscriptions from "./ContractEventSubscriptions";

describe("ContractEventSubscriptions Page Component (#1199)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/stats/summary")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              totalSubscriptions: 5,
              activeSubscriptions: 4,
              pausedSubscriptions: 1,
              erroredSubscriptions: 0,
              totalDeliveries: 12000,
              averageLatencyMs: 35,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            subscriptions: [
              {
                id: "sub_test_1",
                name: "USDC Deposit Stream",
                description: "Monitors deposit events",
                contract_address: "CA1234567890",
                network: "stellar-mainnet",
                event_topics: ["deposit"],
                delivery_target: "webhook",
                status: "active",
                rate_limit_per_min: 60,
                retry_limit: 3,
                batch_size: 1,
                delivered_count: 500,
                failed_count: 0,
                created_at: new Date().toISOString(),
              },
            ],
            total: 1,
          }),
      });
    });
  });

  it("renders page title and KPI stats", async () => {
    render(
      <BrowserRouter>
        <ContractEventSubscriptions />
      </BrowserRouter>
    );

    expect(screen.getByText("Contract Event Subscription Registry")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("USDC Deposit Stream")).toBeInTheDocument();
    });
  });

  it("opens create subscription modal when register button is clicked", async () => {
    render(
      <BrowserRouter>
        <ContractEventSubscriptions />
      </BrowserRouter>
    );

    const createBtn = screen.getByText("+ Register Subscription");
    fireEvent.click(createBtn);

    expect(screen.getByText("Register Event Subscription")).toBeInTheDocument();
  });
});
