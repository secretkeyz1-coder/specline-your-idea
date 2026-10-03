/**
 * Domain error with stable machine-readable codes (docs/09_API_CONTRACT.md §1).
 * The API layer maps these to the canonical error envelope; CLI/MCP surface the code.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const errors = {
  unauthorized: (message = "Authentication required") => new DomainError("UNAUTHORIZED", message, 401),
  forbidden: (message = "Not permitted", details?: Record<string, unknown>) =>
    new DomainError("FORBIDDEN", message, 403, details),
  notFound: (entity: string, id?: string) =>
    new DomainError(`${entity.toUpperCase().replace(/\./g, "_")}_NOT_FOUND`, `${entity} not found`, 404, id ? { id } : undefined),
  validation: (message: string, details?: Record<string, unknown>) =>
    new DomainError("VALIDATION_ERROR", message, 422, details),
  invalidTransition: (from: string, action: string) =>
    new DomainError("ILLEGAL_TRANSITION", `Illegal transition: cannot ${action} from ${from}`, 409, { from, action }),
  taskNotReady: (taskId: string) =>
    new DomainError("TASK_NOT_READY", "Task cannot be claimed.", 409, { task_id: taskId }),
  taskAlreadyClaimed: (taskId: string) =>
    new DomainError("TASK_ALREADY_CLAIMED", "An active claim already exists for this task.", 409, { task_id: taskId }),
  conflict: (code: string, message: string, details?: Record<string, unknown>) =>
    new DomainError(code, message, 409, details),
  rateLimited: (scope: string) => new DomainError("RATE_LIMITED", `Too many requests (${scope})`, 429),
  internal: (message = "Internal error") => new DomainError("INTERNAL", message, 500),
};

/**
 * True when `error` (or any error in its `cause` chain — drizzle wraps driver
 * errors) is a PostgreSQL unique violation (SQLSTATE 23505), optionally on a
 * named constraint/index. Lets a check-then-insert race surface as a 409
 * instead of an opaque 500.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const { errno, code } = e as { errno?: unknown; code?: unknown };
    if (errno === "23505" || code === "23505") {
      if (!constraint) return true;
      const named = (e as { constraint?: unknown; constraint_name?: unknown }).constraint ?? (e as { constraint_name?: unknown }).constraint_name;
      return typeof named === "string" ? named === constraint : String((e as { message?: unknown }).message ?? "").includes(constraint);
    }
  }
  return false;
}
