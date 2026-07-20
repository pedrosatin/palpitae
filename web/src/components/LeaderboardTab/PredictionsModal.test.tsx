import { describe, it, expect } from "vitest";
import { groupedByGroupName } from "./PredictionsModal";
import type { UserPrediction } from "./types";

describe("groupedByGroupName", () => {
  const basePrediction = {
    match_id: "m1",
    predicted_home_score: null,
    predicted_away_score: null,
    points_awarded: null,
    match_status: "scheduled",
    match_start_time: "2026-01-01T00:00:00Z",
    home_score: null,
    away_score: null,
    round: "r1",
    round_label: "Round 1",
    home_team_name: "Team A",
    home_team_short_name: "A",
    home_team_logo: "logo-a.png",
    away_team_name: "Team B",
    away_team_short_name: "B",
    away_team_logo: "logo-b.png",
  };

  it("handles an empty array", () => {
    expect(groupedByGroupName([])).toEqual([]);
  });

  it("groups consecutive items with the same group_name", () => {
    const predictions: UserPrediction[] = [
      { ...basePrediction, match_id: "m1", group_name: "A" },
      { ...basePrediction, match_id: "m2", group_name: "A" },
      { ...basePrediction, match_id: "m3", group_name: "B" },
    ];

    const result = groupedByGroupName(predictions);

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe("A");
    expect(result[0][1]).toHaveLength(2);
    expect(result[0][1][0].match_id).toBe("m1");
    expect(result[0][1][1].match_id).toBe("m2");

    expect(result[1][0]).toBe("B");
    expect(result[1][1]).toHaveLength(1);
    expect(result[1][1][0].match_id).toBe("m3");
  });

  it("groups items with null group_name", () => {
    const predictions: UserPrediction[] = [
      { ...basePrediction, match_id: "m1", group_name: null },
      { ...basePrediction, match_id: "m2", group_name: null },
    ];

    const result = groupedByGroupName(predictions);

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBeNull();
    expect(result[0][1]).toHaveLength(2);
  });

  it("creates new groups for alternating group_names", () => {
    const predictions: UserPrediction[] = [
      { ...basePrediction, match_id: "m1", group_name: "A" },
      { ...basePrediction, match_id: "m2", group_name: "B" },
      { ...basePrediction, match_id: "m3", group_name: "A" },
    ];

    const result = groupedByGroupName(predictions);

    expect(result).toHaveLength(3);
    expect(result[0][0]).toBe("A");
    expect(result[0][1]).toHaveLength(1);
    expect(result[0][1][0].match_id).toBe("m1");

    expect(result[1][0]).toBe("B");
    expect(result[1][1]).toHaveLength(1);
    expect(result[1][1][0].match_id).toBe("m2");

    expect(result[2][0]).toBe("A");
    expect(result[2][1]).toHaveLength(1);
    expect(result[2][1][0].match_id).toBe("m3");
  });
});
