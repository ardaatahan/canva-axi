export function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function toonValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[,"\n\r]/.test(text)) {
    return `"${text
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/"/g, '""')}"`;
  }
  return text;
}

export function emitList(
  name: string,
  rows: Array<Record<string, unknown>>,
  fields: string[],
): string {
  return [
    `${name}[${rows.length}]{${fields.join(",")}}:`,
    ...rows.map(
      (row) => ` ${fields.map((field) => toonValue(row[field])).join(",")}`,
    ),
  ].join("\n");
}

export function emitBlock(name: string, lines: string[]): string {
  return [`${name}[${lines.length}]:`, ...lines.map((line) => ` ${line}`)].join(
    "\n",
  );
}

export function emitKV(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${toonValue(item)}`.trimEnd())
    .join("\n");
}

export function formatOutput(value: unknown, json: boolean): string {
  if (json) return JSON.stringify(value, null, 2);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return emitKV(value as Record<string, unknown>);
  }
  return `value: ${toonValue(value)}`;
}

export function parseToon(text: string): { ok: boolean; errorLine?: number } {
  const lines = text.split("\n");
  let allowIndent = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      if (!allowIndent) return { ok: false, errorLine: index + 1 };
      continue;
    }
    if (!/^[A-Za-z][\w.-]*(\[[^\]]*])?(\{[^}]*})?:(\s.*|)$/.test(line)) {
      return { ok: false, errorLine: index + 1 };
    }
    allowIndent = true;
  }
  return { ok: true };
}
