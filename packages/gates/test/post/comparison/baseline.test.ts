import { describe, expect, it } from "vitest";
import { selectBaseline } from "../../../src/index.js";

const releases = [
  {
    releaseId: "old",
    deployedAt: "2026-10-01T00:00:00Z",
    healthy: true,
    trusted: true,
    samples: 1000
  },
  {
    releaseId: "incident",
    deployedAt: "2026-10-04T00:00:00Z",
    healthy: true,
    trusted: true,
    samples: 1000,
    duringIncident: true
  },
  {
    releaseId: "deploying",
    deployedAt: "2026-10-05T00:00:00Z",
    healthy: true,
    trusted: true,
    samples: 1000,
    duringDeployment: true
  },
  {
    releaseId: "previous",
    deployedAt: "2026-10-05T12:00:00Z",
    healthy: true,
    trusted: true,
    samples: 1000
  }
] as const;

describe("comparison baseline selection", () => {
  it("prefers a safe explicit release", () => {
    expect(
      selectBaseline({
        candidates: releases,
        explicitReleaseId: "old",
        candidateReleaseId: "candidate",
        lookbackStart: "2026-09-30T00:00:00Z",
        minimumSamples: 500
      })
    ).toMatchObject({ status: "selected", baseline: { releaseId: "old" } });
  });

  it("discovers the most recent previous healthy release", () => {
    expect(
      selectBaseline({
        candidates: releases,
        candidateReleaseId: "candidate",
        lookbackStart: "2026-09-30T00:00:00Z",
        minimumSamples: 500
      })
    ).toMatchObject({ status: "selected", baseline: { releaseId: "previous" } });
  });

  it.each([
    ["missing", [], "No safe baseline release is available"],
    [
      "outside lookback",
      [
        {
          releaseId: "old",
          deployedAt: "2026-01-01T00:00:00Z",
          healthy: true,
          trusted: true,
          samples: 1000
        }
      ],
      "No safe baseline release is available"
    ],
    [
      "incident",
      [
        {
          releaseId: "old",
          deployedAt: "2026-10-05T00:00:00Z",
          healthy: true,
          trusted: true,
          samples: 1000,
          duringIncident: true
        }
      ],
      "No safe baseline release is available"
    ],
    [
      "deployment",
      [
        {
          releaseId: "old",
          deployedAt: "2026-10-05T00:00:00Z",
          healthy: true,
          trusted: true,
          samples: 1000,
          duringDeployment: true
        }
      ],
      "No safe baseline release is available"
    ],
    [
      "low samples",
      [
        {
          releaseId: "old",
          deployedAt: "2026-10-05T00:00:00Z",
          healthy: true,
          trusted: true,
          samples: 499
        }
      ],
      "No safe baseline release is available"
    ],
    [
      "identity collision",
      [
        {
          releaseId: "candidate",
          deployedAt: "2026-10-05T00:00:00Z",
          healthy: true,
          trusted: true,
          samples: 1000
        }
      ],
      "No safe baseline release is available"
    ]
  ])("returns insufficient evidence for %s", (_case, candidates, reason) => {
    expect(
      selectBaseline({
        candidates,
        candidateReleaseId: "candidate",
        lookbackStart: "2026-10-01T00:00:00Z",
        minimumSamples: 500
      })
    ).toEqual({ status: "insufficient", reason });
  });
});
