const REDACTED = "[REDACTED]";

const sensitiveKeyPattern =
  /(?:token|password|secret|cookie|authorization|set-cookie|api[_-]?key|(?:^|[_-])key(?:$|[_-]))/iu;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const urlPattern = /https?:\/\/[^\s]+/giu;

function redactString(value: string): string {
  const withoutQueries = value.replace(urlPattern, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.search.length === 0) {
        return candidate;
      }
      return `${url.origin}${url.pathname}?${REDACTED}${url.hash}`;
    } catch {
      return candidate;
    }
  });

  return withoutQueries.replace(bearerPattern, `Bearer ${REDACTED}`);
}

export class Redactor {
  public redactValue<T>(value: T): T {
    return this.redact(value, new WeakSet<object>()) as T;
  }

  private redact(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === "string") {
      return redactString(value);
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (seen.has(value)) {
      return REDACTED;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, seen));
    }

    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = sensitiveKeyPattern.test(key) ? REDACTED : this.redact(nestedValue, seen);
    }
    return result;
  }
}
