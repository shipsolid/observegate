import { EvidenceStore } from "../evidence/store.js";
import { GateError } from "../errors/gate-error.js";
import { createDeadline, raceWithSignal, cancellationError } from "./deadline.js";
import type { Phase, GateResult } from "../domain/gates.js";
import type { PlannedGate } from "../domain/planning.js";

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(private readonly limit: number) {}

  public async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw signal.reason ?? cancellationError();
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener("abort", cancel);
        this.active += 1;
        resolve();
      };
      const cancel = () => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason ?? cancellationError());
      };
      this.waiting.push(grant);
      signal.addEventListener("abort", cancel, { once: true });
    });
    return () => this.release();
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}

export interface ScheduledGateContext {
  readonly signal: AbortSignal;
  readonly evidenceStore: EvidenceStore;
}

export interface SchedulerRunInput {
  readonly phase: Phase;
  readonly gates: readonly PlannedGate[];
  readonly phaseDeadlineMs: number;
  readonly signal: AbortSignal;
  readonly failFast?: boolean;
  readonly execute: (gate: PlannedGate, context: ScheduledGateContext) => Promise<GateResult>;
}

export interface ExecutionSchedulerOptions {
  readonly globalConcurrency?: number;
  readonly perProviderConcurrency?: number;
  readonly clock?: () => Date;
}

function errorResult(
  phase: Phase,
  gate: PlannedGate,
  error: unknown,
  clock: () => Date
): GateResult {
  const now = clock().toISOString();
  const gateError =
    error instanceof GateError
      ? error
      : new GateError({
          code: "INTERNAL",
          safeMessage: "Gate execution failed unexpectedly.",
          retryable: false,
          gateId: gate.id,
          cause: error
        });
  return Object.freeze({
    id: gate.id,
    name: gate.name,
    type: gate.type,
    phase,
    enforcement: gate.enforcement,
    status: "error",
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    assertions: Object.freeze([]),
    evidence: Object.freeze([]),
    diagnostics: Object.freeze([{ ...gateError.toDiagnostic(), gateId: gate.id }])
  });
}

function skippedAfterFailure(phase: Phase, gate: PlannedGate, clock: () => Date): GateResult {
  const now = clock().toISOString();
  return Object.freeze({
    id: gate.id,
    name: gate.name,
    type: gate.type,
    phase,
    enforcement: gate.enforcement,
    status: "skipped",
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    assertions: Object.freeze([]),
    evidence: Object.freeze([]),
    diagnostics: Object.freeze([
      {
        code: "GATE_EVALUATION",
        message: "Gate was skipped after a blocking gate failed (failFast).",
        retryable: false,
        gateId: gate.id
      }
    ])
  });
}

export class ExecutionScheduler {
  private readonly globalConcurrency: number;
  private readonly perProviderConcurrency: number;
  private readonly clock: () => Date;

  public constructor(options: ExecutionSchedulerOptions = {}) {
    this.globalConcurrency = options.globalConcurrency ?? 8;
    this.perProviderConcurrency = options.perProviderConcurrency ?? 4;
    this.clock = options.clock ?? (() => new Date());
  }

  public async run(input: SchedulerRunInput): Promise<readonly GateResult[]> {
    const phaseDeadline = createDeadline(input.signal, input.phaseDeadlineMs, {
      message: `Phase execution exceeded ${input.phaseDeadlineMs} ms.`
    });
    const evidenceStore = new EvidenceStore(this.clock);
    const providerSemaphores = new Map<string, Semaphore>();
    const results: Array<GateResult | undefined> = new Array(input.gates.length);
    let nextIndex = 0;
    let stoppedEarly = false;

    const takeNext = (): { gate: PlannedGate; position: number } | undefined => {
      if (stoppedEarly || phaseDeadline.signal.aborted || nextIndex >= input.gates.length)
        return undefined;
      const position = nextIndex;
      nextIndex += 1;
      const gate = input.gates[position];
      return gate === undefined ? undefined : { gate, position };
    };

    const runOne = async (gate: PlannedGate): Promise<GateResult> => {
      const gateDeadline = createDeadline(phaseDeadline.signal, gate.timeoutMs, {
        message: `Gate ${gate.id} exceeded ${gate.timeoutMs} ms.`
      });
      const releases: Array<() => void> = [];
      try {
        const providers = [
          ...new Set(gate.providerRequirements.map((requirement) => requirement.provider))
        ].sort();
        for (const provider of providers) {
          const semaphore =
            providerSemaphores.get(provider) ?? new Semaphore(this.perProviderConcurrency);
          providerSemaphores.set(provider, semaphore);
          releases.push(await semaphore.acquire(gateDeadline.signal));
        }
        if (stoppedEarly) return skippedAfterFailure(input.phase, gate, this.clock);
        const outcome = await raceWithSignal(
          input.execute(gate, { signal: gateDeadline.signal, evidenceStore }),
          gateDeadline.signal
        );
        if (
          input.failFast === true &&
          gate.enforcement === "blocking" &&
          (outcome.status === "failed" ||
            outcome.status === "error" ||
            outcome.status === "inconclusive")
        )
          stoppedEarly = true;
        return outcome;
      } catch (error) {
        if (input.failFast === true && gate.enforcement === "blocking") stoppedEarly = true;
        return errorResult(input.phase, gate, error, this.clock);
      } finally {
        for (const release of releases.reverse()) release();
        gateDeadline.dispose();
      }
    };

    const workers = Array.from(
      { length: Math.min(this.globalConcurrency, input.gates.length) },
      async () => {
        while (true) {
          const work = takeNext();
          if (work === undefined) return;
          const outcome = await runOne(work.gate);
          results[work.position] = outcome;
        }
      }
    );

    await Promise.all(workers);
    const abortReason = phaseDeadline.signal.reason ?? input.signal.reason ?? cancellationError();
    for (let index = 0; index < input.gates.length; index += 1) {
      if (results[index] === undefined) {
        const gate = input.gates[index];
        if (gate !== undefined) {
          results[index] =
            stoppedEarly && !phaseDeadline.signal.aborted
              ? skippedAfterFailure(input.phase, gate, this.clock)
              : errorResult(input.phase, gate, abortReason, this.clock);
        }
      }
    }
    phaseDeadline.dispose();
    return Object.freeze(results.filter((item): item is GateResult => item !== undefined));
  }
}
