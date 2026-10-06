import { createGateResult, type GateResult } from "../domain/gates.js";
import type { ExecutionPlan, PlannedGate } from "../domain/planning.js";
import { abortPromise, createDeadline, sleep } from "../execution/deadline.js";
import { ExecutionScheduler } from "../execution/scheduler.js";
import type { GateExecutor } from "./run-gate.js";

export interface ObservationSchedule {
  readonly warmupMs: number;
  readonly evaluationWindowMs?: number;
  readonly sampleIntervalMs: number;
  readonly minimumSuccessfulSamples: number;
  readonly maximumExtensionMs: number;
}

export interface RunPhaseInput {
  readonly plan: ExecutionPlan;
  readonly observation: ObservationSchedule;
  readonly signal: AbortSignal;
  readonly executeGate: GateExecutor;
  readonly scheduler?: ExecutionScheduler;
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly sample?: (signal: AbortSignal) => Promise<boolean>;
  readonly clock?: () => Date;
}

function insufficientSampleResult(gate: PlannedGate, phase: ExecutionPlan["phase"], now: Date) {
  return createGateResult({
    id: gate.id,
    name: gate.name,
    type: gate.type,
    phase,
    enforcement: gate.enforcement,
    status:
      gate.applicability === "skipped"
        ? "skipped"
        : gate.enforcement === "advisory"
          ? "warned"
          : "inconclusive",
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    durationMs: 0,
    assertions: [],
    evidence: [],
    diagnostics:
      gate.applicability === "skipped"
        ? []
        : [
            {
              code: "EVIDENCE_INVALID",
              message: "Insufficient successful observation samples.",
              retryable: false,
              gateId: gate.id
            }
          ]
  });
}

export async function runPhase(input: RunPhaseInput): Promise<readonly GateResult[]> {
  const clock = input.clock ?? (() => new Date());
  const startedAt = clock().getTime();
  const deadline = createDeadline(input.signal, input.plan.deadlineMs, {
    message: `Phase execution exceeded ${input.plan.deadlineMs} ms.`
  });
  try {
    if (input.plan.phase === "post_deployment" && input.observation.warmupMs > 0) {
      await (input.wait ?? sleep)(input.observation.warmupMs, deadline.signal);
    }

    if (input.sample !== undefined) {
      if (input.plan.phase === "pre_deployment") {
        await Promise.race([input.sample(deadline.signal), abortPromise(deadline.signal)]);
      } else {
        let successfulSamples = 0;
        const sampleBudget =
          (input.observation.evaluationWindowMs ?? 0) + input.observation.maximumExtensionMs;
        const sampleDeadline =
          sampleBudget > 0 ? Math.min(input.plan.deadlineMs, sampleBudget) : input.plan.deadlineMs;
        const sampleStartedAt = clock().getTime();
        while (
          successfulSamples < input.observation.minimumSuccessfulSamples &&
          clock().getTime() - sampleStartedAt <= sampleDeadline
        ) {
          const successful = await Promise.race([
            input.sample(deadline.signal),
            abortPromise(deadline.signal)
          ]);
          if (successful) successfulSamples += 1;
          if (successfulSamples < input.observation.minimumSuccessfulSamples) {
            await (input.wait ?? sleep)(input.observation.sampleIntervalMs, deadline.signal);
          }
        }
        if (successfulSamples < input.observation.minimumSuccessfulSamples) {
          const now = clock();
          return Object.freeze(
            input.plan.gates.map((gate) => insufficientSampleResult(gate, input.plan.phase, now))
          );
        }
      }
    }

    const elapsed = Math.max(0, clock().getTime() - startedAt);
    const remainingMs = Math.max(0, input.plan.deadlineMs - elapsed);
    const scheduler =
      input.scheduler ??
      new ExecutionScheduler({
        ...(input.plan.concurrency === undefined
          ? {}
          : { globalConcurrency: input.plan.concurrency }),
        ...(input.plan.perProviderConcurrency === undefined
          ? {}
          : { perProviderConcurrency: input.plan.perProviderConcurrency }),
        clock
      });
    return await scheduler.run({
      phase: input.plan.phase,
      gates: input.plan.gates,
      phaseDeadlineMs: remainingMs,
      signal: deadline.signal,
      execute: input.executeGate
    });
  } finally {
    deadline.dispose();
  }
}
