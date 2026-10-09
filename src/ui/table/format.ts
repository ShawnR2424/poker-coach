// Money and label formatting for the table. Amounts are integer chips (cents).

export const dollars = (cents: number): string => {
  const v = cents / 100;
  return `$${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}`;
};

export const bbs = (chips: number, bb: number): string => {
  const v = chips / bb;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}bb`;
};

export const pct = (x: number, d = 0): string => `${(x * 100).toFixed(d)}%`;
