export type VmServiceManager = "windows" | "systemd";

export interface VmServiceEvidence {
  readonly hostId: string;
  readonly manager: VmServiceManager;
  readonly name: string;
  readonly state: string;
  readonly exitCode: number;
  readonly restarts: number;
}

export interface VmReleaseEvidence {
  readonly hostId: string;
  readonly releaseId: string;
}
