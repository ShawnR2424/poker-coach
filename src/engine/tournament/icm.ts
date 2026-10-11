// The Independent Chip Model (Malmuth-Harville): each player's share of the remaining prize money
// from the chip stacks alone. A player finishes first with probability stack / total chips; given
// who finished first, the next place is shared the same way among the rest, and so on.

/**
 * Each player's expected payout. `payouts` lists the prize for 1st, 2nd, ... (places beyond its
 * length pay nothing). Players with no chips are out: they take the lowest places, in the order
 * given (a hand busts at most one player in this trainer).
 */
export function icmEquities(stacks: readonly number[], payouts: readonly number[]): number[] {
  const n = stacks.length;
  if (n > 12) throw new Error('ICM supports up to 12 players');
  const out = new Array<number>(n).fill(0);
  const alive: number[] = [];
  const busted: number[] = [];
  stacks.forEach((s, i) => (s > 1e-9 ? alive : busted).push(i));
  // Busted players take the places after everyone still alive.
  busted.forEach((i, k) => { out[i] = payouts[alive.length + k] ?? 0; });

  const m = alive.length;
  const pay = (place: number) => payouts[place] ?? 0;
  const anyPaidAfter = (place: number) => payouts.slice(place).some((x) => x > 0);
  // memo[mask] = each alive player's expected payout from the places still open when `mask` are left.
  const memo = new Map<number, Float64Array>();
  const solve = (mask: number): Float64Array => {
    const hit = memo.get(mask);
    if (hit) return hit;
    const res = new Float64Array(m);
    let left = 0, total = 0;
    for (let k = 0; k < m; k++) if (mask & (1 << k)) { left++; total += stacks[alive[k]]; }
    const place = m - left;
    if (left === 1 || !anyPaidAfter(place)) {
      // One player left takes this place; with no prize left to win, everyone gets nothing more.
      if (left === 1) for (let k = 0; k < m; k++) if (mask & (1 << k)) res[k] = pay(place);
      memo.set(mask, res);
      return res;
    }
    for (let k = 0; k < m; k++) {
      if (!(mask & (1 << k))) continue;
      const p = stacks[alive[k]] / total;
      res[k] += p * pay(place);
      const rest = solve(mask & ~(1 << k));
      for (let j = 0; j < m; j++) res[j] += p * rest[j];
    }
    memo.set(mask, res);
    return res;
  };
  const top = solve((1 << m) - 1);
  alive.forEach((i, k) => { out[i] = top[k]; });
  return out;
}
