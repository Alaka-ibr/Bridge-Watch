import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiskFactorBreakdown } from "./RiskFactorBreakdown";

describe("RiskFactorBreakdown", () => {
  it("renders every factor with its score", () => {
    render(
      <RiskFactorBreakdown
        factors={{
          reserveBacking: 80,
          operatorReputation: 70,
          transactionHistory: 60,
          anomalyFrequency: 40,
          resolutionTime: 20,
        }}
      />,
    );

    expect(screen.getByText("Risk Factors")).toBeInTheDocument();
    expect(screen.getByText("Reserve Backing (35%)")).toBeInTheDocument();
    expect(screen.getByText("80/100")).toBeInTheDocument();
    expect(screen.getByText("Operator Reputation (20%)")).toBeInTheDocument();
    expect(screen.getByText("70/100")).toBeInTheDocument();
    expect(screen.getByText("Transaction History (15%)")).toBeInTheDocument();
    expect(screen.getByText("60/100")).toBeInTheDocument();
    expect(screen.getByText("Anomaly Frequency (20%)")).toBeInTheDocument();
    expect(screen.getByText("40/100")).toBeInTheDocument();
    expect(screen.getByText("Resolution Time (10%)")).toBeInTheDocument();
    expect(screen.getByText("20/100")).toBeInTheDocument();
  });
});
