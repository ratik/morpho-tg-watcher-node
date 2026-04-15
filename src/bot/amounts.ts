export function parseHumanAmountToRaw(input: string, decimals: number | null): string {
  if (decimals == null) {
    throw new Error('Vault decimals are missing');
  }

  const normalized = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Enter a positive numeric threshold, e.g. 1000 or 1234.56');
  }

  const [wholePart = '0', fractionPart = ''] = normalized.split('.');
  if (fractionPart.length > decimals) {
    throw new Error(`Too many decimal places. This vault supports up to ${decimals} decimals.`);
  }

  const whole = BigInt(wholePart);
  const fraction = BigInt((fractionPart + '0'.repeat(decimals)).slice(0, decimals) || '0');
  const multiplier = 10n ** BigInt(decimals);

  return (whole * multiplier + fraction).toString();
}

export function formatRawAmount(raw: string, decimals: number | null, symbol: string | null): string {
  if (decimals == null) {
    return `${raw}${symbol ? ` ${symbol}` : ''}`;
  }

  const rawBigInt = BigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = rawBigInt / divisor;
  const fraction = rawBigInt % divisor;
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  const formatted = fractionText.length > 0 ? `${whole}.${fractionText}` : whole.toString();

  return `${formatted}${symbol ? ` ${symbol}` : ''}`;
}
