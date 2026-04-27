export function parseDecimalAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: ${value}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places.`);
  }
  const paddedFraction = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "") || "0");
}

export function formatAtomicAmount(value: bigint, decimals: number): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const digits = abs.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals) || "0";
  const fraction = decimals > 0 ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function compareDecimalAmounts(left: string, right: string, decimals: number): number {
  const a = parseDecimalAmount(left, decimals);
  const b = parseDecimalAmount(right, decimals);
  return a === b ? 0 : a > b ? 1 : -1;
}
