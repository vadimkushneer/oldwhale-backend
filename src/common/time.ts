export function nowIso(): string {
  return new Date().toISOString();
}

export function boolFromDb(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
