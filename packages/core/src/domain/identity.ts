export interface TargetIdentity {
  readonly id: string;
  readonly runtimeType: string;
  readonly provider: string;
}

export interface ReleaseIdentity {
  readonly candidateId: string;
  readonly deploymentId: string;
  readonly baselineId?: string;
}

export interface CanonicalIdentity {
  readonly serviceName: string;
  readonly serviceNamespace: string;
  readonly environment: string;
  readonly releaseId: string;
  readonly deploymentId: string;
}
