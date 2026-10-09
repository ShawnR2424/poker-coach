# Poker Coach

A turn-by-turn 6-max No-Limit Hold'em trainer with approximate-GTO feedback. You play the hero seat; before every decision the app shows each opponent's likely range, then grades your action with computed math.

This is **approximate GTO**: static preflop charts and heuristic postflop range narrowing, not a live solver.

## Status

- [x] **Milestone 1: engine.** Deck, hand evaluator, betting rules (min-raise, short all-ins, side pots, uncalled bets), range notation and 13x13 grid, card removal, equity (exact heads-up postflop, Monte Carlo preflop and multiway, in a Web Worker), pot odds, break-even fold %, bet EV, SPR. A small lab page exercises all of it.
- [x] **Milestone 2: table UI.** Oval table with seats in clockwise order, hero fixed at bottom center, status badges, dealer button, aggressor outline, board and pot, hero strip with spot-dependent stat tiles, action timeline, range read layout, and action buttons with preset and custom sizes. Three hard-coded sample hands built with the real engine. Works at 380px and in light and dark.
- [x] **Milestone 3: preflop.** Editable 6-max 100bb charts in `data/preflop/` (open, vs open, vs 3-bet, vs 4-bet, squeeze, cold 4-bet, vs all-in, vs limp) with a low-stakes adjustment layer. Level 1 practice: generated preflop spots that stop at a real decision, a range read per opponent with a 13x13 grid colored by matchup against your hand, grading with chart frequencies, computed equity and pot odds, and a chart grid showing which hands take each action. Opponents respond from the same charts.
- [ ] 4. Pot odds and verdict logic in the game flow
- [ ] 5. Postflop narrowing, opponent profiles, full hands
- [ ] 6. Multiway and the combo table
- [ ] 7. Session tracker, leaks, curriculum
- [ ] 8. Optional Claude API explanations

## Run it

```sh
npm install
npm run dev     # app at http://localhost:5173 (Table and Engine lab tabs)
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
  sizing.ts       preset bet and raise sizes for the action buttons
  __tests__/
src/workers/    equity Web Worker and its client
src/engine/preflop/  chart loading, spot detection, range narrowing, scenarios, grading
src/ui/         React UI (table/ = table pieces, play/ = practice screen)
data/preflop/   preflop charts and the low-stakes layer (JSON, editable)
data/hand-rank.json  starting hands by strength (npm run gen:hand-rank)
```

## Guarantees the tests check

- The evaluator agrees with an independent brute-force evaluator on 20,000 random hand pairs.
- Every range survives text -> combos -> text -> combos unchanged, so the grid can't drift from the range text.
- Combo counts exclude hero and board cards.
- Chips balance on every step of 3,000 randomly played hands.
- Break-even fold % gives exactly zero bet EV, and calling at the pot-odds equity gives exactly zero call EV.
- Every chart parses, round-trips through text, and never puts more than 100% on a hand.
- Every class with live combos in a range gets exactly one grid category, and category totals equal the range's live combo count.
- Generated hands stop at the hero's decision, and every opponent raise comes from a hand their chart raises.
