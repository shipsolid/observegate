const stringChunkSize = 16 * 1024;

function* quotedStringChunks(value: string): Iterable<string> {
  yield '"';
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + stringChunkSize);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end += 1;
    const encoded = JSON.stringify(value.slice(offset, end));
    yield encoded.slice(1, -1);
    offset = end;
  }
  yield '"';
}

export function* jsonChunks(value: unknown, depth = 0): Iterable<string> {
  if (typeof value === "string") {
    yield* quotedStringChunks(value);
    return;
  }
  if (value === null || typeof value !== "object") {
    yield JSON.stringify(value) ?? "null";
    return;
  }
  const indent = " ".repeat(depth);
  const childIndent = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      yield "[]";
      return;
    }
    yield "[\n";
    for (let index = 0; index < value.length; index += 1) {
      yield childIndent;
      yield* jsonChunks(value[index], depth + 2);
      yield index === value.length - 1 ? "\n" : ",\n";
    }
    yield `${indent}]`;
    return;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) {
    yield "{}";
    return;
  }
  yield "{\n";
  for (let index = 0; index < entries.length; index += 1) {
    const [key, item] = entries[index] as [string, unknown];
    yield childIndent;
    yield* quotedStringChunks(key);
    yield ": ";
    yield* jsonChunks(item, depth + 2);
    yield index === entries.length - 1 ? "\n" : ",\n";
  }
  yield `${indent}}`;
}

export function collectChunks(chunks: Iterable<string>): string {
  return [...chunks].join("");
}
