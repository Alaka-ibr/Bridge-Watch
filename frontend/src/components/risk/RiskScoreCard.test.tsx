import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiskScoreCard } from "./RiskScoreCard";

describe("RiskScoreCard", () => {
  it.each([
    ["LOW", "12"],
    ["MODERATE", "42"],
    ["HIGH", "68"],
    ["CRITICAL", "91"],
  ])("renders the %s severity level and score", (level, score) => {
    render(<RiskScoreCard level={level} score={Number(score)} />);

    expect(screen.getByText("Bridge Risk Score")).toBeInTheDocument();
    expect(screen.getByText(score)).toBeInTheDocument();
    expect(screen.getByText(level)).toBeInTheDocument();
  });
});
