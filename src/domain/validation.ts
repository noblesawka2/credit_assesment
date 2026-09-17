export class DomainError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export function requireControl(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DomainError(code);
}
export function money(value: unknown): bigint {
  requireControl(typeof value === "string" && /^(0|[1-9][0-9]{0,23})$/.test(value), "INVALID_MONEY");
  return BigInt(value);
}
export function integer(value: unknown, minimum: number, maximum: number): asserts value is number {
  requireControl(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum, "INVALID_INTEGER");
}
export function nonnegative(value: bigint): void {
  requireControl(typeof value === "bigint" && value >= 0n, "INVALID_MONEY");
}
export function reason(value: unknown): asserts value is string {
  requireControl(typeof value === "string" && value.trim().length >= 8 && value.length <= 2000, "REASON_REQUIRED");
}
export function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}
