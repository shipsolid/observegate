import type { Evidence } from "@observability-gate/core";

export interface RuntimeCondition {
  readonly type: string;
  readonly status: string;
  readonly reason?: string;
  readonly message?: string;
}

export interface RuntimeEvent {
  readonly type: string;
  readonly reason: string;
  readonly message?: string;
  readonly involvedObject: string;
  readonly observedAt?: string;
}

export interface ReleaseObservation {
  readonly source: string;
  readonly releaseId: string;
  readonly instanceId?: string;
}

export interface RuntimeSnapshot {
  readonly target: string;
  readonly runtimeType: string;
  readonly observedAt: string;
  readonly releaseIdentities: readonly ReleaseObservation[];
  readonly conditions: readonly RuntimeCondition[];
  readonly events: readonly RuntimeEvent[];
}

export interface RuntimeSnapshotRequest {
  readonly target: string;
  readonly signal: AbortSignal;
}

export interface RuntimeAdapter<
  TRequest extends RuntimeSnapshotRequest,
  TSnapshot extends RuntimeSnapshot
> {
  getSnapshot(request: TRequest): Promise<Evidence<TSnapshot>>;
}
