export function parseByteSize(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return fallback;
  const match = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB)$/iu.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return fallback;
  const multiplier = { b: 1, kib: 1_024, mib: 1_048_576 }[match[2].toLowerCase()];
  const bytes = Math.floor(Number(match[1]) * (multiplier ?? 1));
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : fallback;
}
