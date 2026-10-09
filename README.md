# Poker Coach

A turn-by-turn 6-max No-Limit Hold'em trainer with approximate-GTO feedback. You play the hero seat; before every decision the app shows each opponent's likely range, then grades your action with computed math.

This is **approximate GTO**: static preflop charts and heuristic postflop range narrowing, not a live solver.

## Status

- [x] **Milestone 1: engine.** Deck, hand evaluator, betting rules (min-raise, short all-ins, side pots, uncalled bets), range notation and 13x13 grid, card removal, equity (exact heads-up postflop, Monte Carlo preflop and multiway, in a Web Worker), pot odds, break-even fold %, bet EV, SPR. A small lab page exercises all of it.
- [ ] 2. Static table UI
- [ ] 3. Preflop charts, scenarios, range grid and feedback
- [ ] 4. Pot odds and verdict logic in the game flow
- [ ] 5. Postflop narrowing, opponent profiles, full hands
- [ ] 6. Multiway and the combo table
- [ ] 7. Session tracker, leaks, curriculum
- [ ] 8. Optional Claude API explanations

## Run it

```sh
npm install
npm run dev     # lab page at http://localhost:5173
npm test        # engine tests (Vitest)
npm run build   # typecheck + production build
```

## Layout

```
src/engine/     framework-free poker logic, all amounts in integer chips (cents)
  cards.ts        card ids 0..51, parsing and formatting
  evaluator.ts    5-7 card evaluator
  hand.ts         hand state machine: blinds, legal actions, streets, side pots, showdown
  positions.ts    6-9 handed seat labels
  range.ts        notation <-> weighted combos, 13x13 grid, card removal
  equity.ts       hero equity vs weighted ranges
  math.ts         pot odds, break-even fold %, bet EV, MDF, SPR
  __tests__/
src/workers/    equity Web Worker and its client
src/ui/         React UI
data/           range and strategy JSON (from milestone 3)
```

## Guarantees the tests check

- The evaluator agrees with an independent brute-force evaluator on 20,000 random hand pairs.
- Every range survives text -> combos -> text -> combos unchanged, so the grid can't drift from the range text.
- Combo counts exclude hero and board cards.
- Chips balance on every step of 3,000 randomly played hands.
- Break-even fold % gives exactly zero bet EV, and calling at the pot-odds equity gives exactly zero call EV.
