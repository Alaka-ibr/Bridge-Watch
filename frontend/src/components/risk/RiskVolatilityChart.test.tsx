import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiskVolatilityChart } from "./RiskVolatilityChart";

describe("RiskVolatilityChart", () => {
  it("renders the volatility index and unit label", () => {
    render(<RiskVolatilityChart volatility={2.75} />);

    expect(screen.getByText("Volatility Index")).toBeInTheDocument();
    expect(screen.getByText("2.75")).toBeInTheDocument();
    expect(screen.getByText("Standard Deviation")).toBeInTheDocument();
  });
});
