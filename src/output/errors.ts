export class AxiError extends Error {
  constructor(
    message: string,
    readonly suggestion: string,
    readonly exitCode: 1 | 2,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AxiError";
  }
}

export class UsageError extends AxiError {
  constructor(message: string, suggestion: string, details?: unknown) {
    super(message, suggestion, 1, details);
    this.name = "UsageError";
  }
}

export class RuntimeError extends AxiError {
  constructor(message: string, suggestion: string, details?: unknown) {
    super(message, suggestion, 2, details);
    this.name = "RuntimeError";
  }
}

export function normalizeError(error: unknown): AxiError {
  if (error instanceof AxiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new RuntimeError(
    `unexpected failure: ${message}`,
    "retry with the same arguments; report the failure if it persists",
  );
}
