export interface VmHostEvidence {
  readonly hostId: string;
  readonly cpuPercent: number;
  readonly memoryPercent: number;
  readonly diskPercent: number;
  readonly load: number;
}

export interface VmAgentEvidence {
  readonly hostId: string;
  readonly up: boolean;
  readonly exportFailures: number;
  readonly queueUtilizationPercent: number;
  readonly lastExportAt: string;
}
