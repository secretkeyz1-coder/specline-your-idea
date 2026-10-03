export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function addMilliseconds(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function isExpired(expiresAt: Date | string | null | undefined, at: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= at.getTime();
}

export function elapsedMs(startedAt: Date | string): number {
  return Date.now() - new Date(startedAt).getTime();
}
