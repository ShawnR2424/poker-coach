import { describe, expect, it } from 'vitest';
import { betEv, breakEvenFoldPct, callEv, mdf, potOdds, spr } from '../math';

describe('pot odds', () => {
  it('is call / (pot + call)', () => {
    // Facing a pot-sized bet: pot 10 + bet 10 = 20 in the middle, call 10 -> 33.3%.
    expect(potOdds(10, 20)).toBeCloseTo(1 / 3, 10);
    // Half-pot bet: pot 10 + 5 = 15, call 5 -> 25%.
    expect(potOdds(5, 15)).toBeCloseTo(0.25, 10);
    expect(potOdds(0, 15)).toBe(0);
  });

  it('calling at exactly the pot-odds equity is zero EV', () => {
    for (const [call, pot] of [[10, 20], [5, 15], [37, 112]]) {
      expect(callEv(call, pot, potOdds(call, pot))).toBeCloseTo(0, 10);
    }
  });
});

describe('break-even fold %', () => {
  it('matches the classic bluff numbers', () => {
    expect(breakEvenFoldPct({ pot: 100, risk: 100 })).toBeCloseTo(0.5, 10);
    expect(breakEvenFoldPct({ pot: 100, risk: 50 })).toBeCloseTo(1 / 3, 10);
    expect(breakEvenFoldPct({ pot: 100, risk: 33 })).toBeCloseTo(33 / 133, 10);
  });

  it('drops as equity when called rises, and hits 0 when the bet is +EV even if always called', () => {
    const base = breakEvenFoldPct({ pot: 100, risk: 100 });
    const semi = breakEvenFoldPct({ pot: 100, risk: 100, equityWhenCalled: 0.2 });
    expect(semi).toBeLessThan(base);
    // Called pot = 300; 0.2 * 300 = 60; lose 40 when called. 40 / (100 + 40).
    expect(semi).toBeCloseTo(40 / 140, 10);
    expect(breakEvenFoldPct({ pot: 100, risk: 100, equityWhenCalled: 0.4 })).toBe(0);
  });

  it('is consistent with betEv: EV is zero at the break-even fold %', () => {
    const cases = [
      { pot: 100, bet: 75, eq: 0 },
      { pot: 60, bet: 200, eq: 0.3 },
      { pot: 250, bet: 120, eq: 0.15 },
    ];
    for (const c of cases) {
      const f = breakEvenFoldPct({ pot: c.pot, risk: c.bet, equityWhenCalled: c.eq });
      expect(betEv({ pot: c.pot, bet: c.bet, foldPct: f, equityWhenCalled: c.eq })).toBeCloseTo(0, 8);
    }
  });

  it('supports a raise where the caller adds less than hero risks', () => {
    // Pot 100 includes villain's bet of 50. Hero raises to 150; villain calls 100 more.
    // Final pot 100 + 150 + 100 = 350. Pure bluff loses 150 when called -> 150 / 250.
    expect(breakEvenFoldPct({ pot: 100, risk: 150, finalPot: 350 })).toBeCloseTo(0.6, 10);
  });
});

describe('other ratios', () => {
  it('computes SPR and MDF', () => {
    expect(spr(450, 100)).toBe(4.5);
    expect(spr(100, 0)).toBe(Infinity);
    expect(mdf(100, 100)).toBe(0.5);
    expect(mdf(100, 50)).toBeCloseTo(2 / 3, 10);
  });
});
