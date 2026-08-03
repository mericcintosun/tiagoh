/**
 * Money — exact integer arithmetic in the payment token's minor units.
 *
 * Prices used to be JS `number` dollars all the way through: config, budget accounting, the
 * wire, and the anchored receipt. That is wrong for money in three separate ways.
 *
 *   1. `0.1 + 0.2 !== 0.3`, so a budget that accumulates float dollars drifts, and a call sitting
 *      exactly on a cap could be allowed or rejected depending on the order of prior calls.
 *   2. The on-chain side has always been integers (a 6-decimal ERC-20). Every float→int
 *      conversion is a rounding decision, and doing it in several places invites them to
 *      disagree — one path multiplied by 100 (cents) while `ReputationScorer` divided by 1e6
 *      (token units), which is a four-order-of-magnitude mismatch.
 *   3. A receipt is co-signed and anchored. Its amount must be exactly the integer that both
 *      parties signed and that the chain stores — not a float that re-serializes differently.
 *
 * So: `number` dollars survive only as an authoring convenience in `tiagoh.config.json`, are
 * converted **once** at config load, and everything downstream is `bigint` minor units. On the
 * wire and in JSON, minor units travel as a base-10 integer string, which is exact and JSON-safe
 * (unlike `bigint`, which `JSON.stringify` refuses outright).
 */

/** Integer amount in the payment token's smallest unit (e.g. 1_000_000 = 1.00 of a 6-dec token). */
export type Minor = bigint;

/** USDC-style default. Overridable per deployment via `assetDecimals` in the config. */
export const DEFAULT_ASSET_DECIMALS = 6;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Base-10 integer string, optionally negative — the JSON/wire form of a minor amount. */
const MINOR_RE = /^-?\d+$/;
/** Plain decimal, no exponent: the form `normalizeDecimal` produces. */
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Convert a major-unit amount (e.g. dollars) to exact minor units.
 *
 * Accepts a decimal string (preferred — exact) or a `number` (converted via its shortest
 * round-tripping decimal form). Digits beyond `decimals` are rounded half-up, which is the
 * conventional money rounding and also absorbs float artifacts such as
 * `0.30000000000000004`.
 */
export function toMinor(value: string | number, decimals: number = DEFAULT_ASSET_DECIMALS): Minor {
  assertDecimals(decimals);
  const text = normalizeDecimal(value);
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new MoneyError(`not a decimal amount: ${String(value)}`);

  const sign = match[1] ?? "";
  const whole = match[2] ?? "0";
  const frac = match[3] ?? "";
  const scaled = frac.padEnd(decimals, "0");
  const kept = scaled.slice(0, decimals);
  const dropped = scaled.slice(decimals);

  let minor = BigInt(whole + kept);
  // Round half-up on the digits that do not fit the token's precision.
  if (dropped !== "" && dropped.charAt(0) >= "5") minor += 1n;
  return sign === "-" ? -minor : minor;
}

/**
 * Format minor units back to a major-unit decimal string. Exact — no float ever involved.
 * Trailing zeros are kept so amounts line up in tables and logs.
 */
export function formatMinor(minor: Minor, decimals: number = DEFAULT_ASSET_DECIMALS): string {
  assertDecimals(decimals);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals === 0 ? "" : `.${digits.slice(digits.length - decimals)}`;
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/** Parse the JSON/wire form (a base-10 integer string) back into minor units. */
export function parseMinor(value: string | Minor): Minor {
  if (typeof value === "bigint") return value;
  if (!MINOR_RE.test(value)) {
    throw new MoneyError(`not an integer minor amount: ${value}`);
  }
  return BigInt(value);
}

/** Serialize minor units for JSON. `JSON.stringify` cannot encode a bigint, so this is required. */
export function serializeMinor(minor: Minor): string {
  return minor.toString();
}

/** Human display with the asset symbol, e.g. `$0.010000`. */
export function displayMinor(
  minor: Minor,
  decimals: number = DEFAULT_ASSET_DECIMALS,
  symbol = "$",
): string {
  return `${symbol}${formatMinor(minor, decimals)}`;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new MoneyError(`invalid token decimals: ${decimals}`);
  }
}

/** Normalizes a number or string into a plain (non-exponential) decimal string. */
function normalizeDecimal(value: string | number): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") throw new MoneyError("empty amount");
    return expandExponent(trimmed);
  }
  if (!Number.isFinite(value)) throw new MoneyError(`not a finite amount: ${value}`);
  return expandExponent(String(value));
}

/** Rewrites `1e-7` / `2.5e+3` style input as a plain decimal string. */
function expandExponent(text: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text.startsWith("+") ? text.slice(1) : text;

  const sign = match[1] ?? "";
  const whole = match[2] ?? "0";
  const frac = match[3] ?? "";
  const exp = Number(match[4] ?? "0");
  const digits = whole + frac;
  const pointAt = whole.length + exp;

  let out: string;
  if (pointAt <= 0) {
    out = `0.${"0".repeat(-pointAt)}${digits}`;
  } else if (pointAt >= digits.length) {
    out = digits + "0".repeat(pointAt - digits.length);
  } else {
    out = `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  }
  return sign === "-" ? `-${out}` : out;
}
