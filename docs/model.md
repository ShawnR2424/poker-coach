# How the trainer models the game

Poker Coach grades decisions with exact arithmetic (equity, pot odds, expected value) applied to an approximate model of how opponents play. This page describes that model and its limits, so you know which numbers to trust as exact and which are estimates.

## Scope

- No-Limit Hold'em, 6 to 9 handed, $0.25/$0.50 or $0.50/$1 blinds, every stack 100bb at the start of each hand. The stakes change the dollar amounts only: in big blinds every spot plays the same.
- No rake, no antes, no straddles, no deeper or shorter stacks.
- One hero seat; the opponents are bots driven by the model below.

## What is exact

These are computed, not estimated, and the unit tests check them:

- Hand strength. A 5-7 card evaluator, checked against an independent brute-force evaluator.
- Betting rules. Minimum raises, short all-ins that do not reopen the action, side pots, uncalled bets returned.
- Card removal. Combos that use the hero's cards or the board are removed from every range before anything is counted.
- Equity. Exact enumeration heads-up from the flop on. Monte Carlo preflop and in multiway pots, which matches exact enumeration to within 1% in the tests.
- Pot odds, break-even fold share, SPR and the EV formulas themselves.

Given a range for each opponent and a response model, the EV numbers are exact. The range and the responses are the approximate part.

## Preflop

- **Charts.** `data/preflop/*.json` holds static raise and call frequencies per hand for opening, facing an open, facing a 3-bet or 4-bet, squeezes, cold 4-bets, jams and limps. They approximate published 100bb 6-max solutions; they are not solver output and were not tuned to a particular solver.
- **7-9 handed.** The charts are written for 6-max. At a bigger table the LJ has the same players behind it as the 6-max UTG and uses that chart; HJ, CO, BTN and the blinds use their own. The seats before the LJ open from tighter early-position charts (`EP1` to `EP3` in `rfi.json`), and anyone facing an open from those seats uses the `_vs_EP` rows, which are tighter than the rows against a 6-max UTG open. These early-position rows are the roughest part of the chart set.
- **Low-stakes layer.** `data/preflop/lowstakes.json` shifts weight between actions for listed hands, for example fewer 4-bet bluffs from the pool. It is on by default and applies separately to how opponents play and to what the hero is told.
- **Grading.** A preflop action is graded by how often the chart takes it with that hand:
  - ✅ correct when the chart takes it at least half the time, or at least as often as any other action;
  - 👍 playable when it is taken at least 10% of the time;
  - ⚠️ mistake otherwise.
- **Sizing.** A raise more than 35% away from the chart size drops from correct to playable ("right idea, wrong size").
- **Opponent ranges.** Each opponent's range is the chart range for every action they took, in order. Spots with no chart (unusual lines such as limp-reraises) are played but not graded.

## Postflop

### Hand classes

Every combo in a range is sorted into one of ten classes by how it connects with the board:

set or better, two pair, overpair, top pair with a good kicker, top pair with a weak kicker, middle pair, weak pair, strong draw, weak draw, air.

The model works with these classes rather than individual combos. That keeps it editable by hand, at the cost of treating, say, every top pair with a good kicker alike.

### Opponent behavior

`data/postflop/actions.json` gives, for each class:

- how often it bets small or big when first to act or checked to;
- how often it continues facing a bet, as a straight line that falls as the bet grows relative to the pot;
- what share of continuing hands raise.

`data/postflop/profiles.json` scales those numbers for four opponent styles: regular, nit, calling station and aggressive. All of these values are estimates of a typical low-stakes pool, not measured from hand histories or taken from a solver.

The same tables do two jobs. They narrow an opponent's range after each action they take, and they predict how the opponent responds to the hero's bets. The bots also act from them, so the range the trainer shows always contains the opponent's real hand.

### Expected value

EV is measured against folding now, so chips already in the pot are sunk. With `P` the pot before the hero acts, `eq` the hero's equity, `R` the share of it the hero realizes and `c` what the opponent adds to call:

| Action | EV |
|---|---|
| Fold | 0 |
| Check | `R·eq·P` |
| Call | `R·eq·(P + c) − c` |
| Bet or raise to `b` | the weighted sum, over every combo in the opponent's range, of fold `·P`, call `·(R·eq·(P + b + c) − b)` and raise `·max(call the shove, −b)` |

Each combo's response comes from its class, and the hero's equity is taken combo by combo, so a bet that only gets called by better hands shows that.

**Realization.** Before the river, raw equity is scaled by how much of it a hand tends to realize: 95% in position and 85% out of position, times a class factor (draws and very strong hands realize more, weak pairs and air less). On the river, or once all-in, equity is realized in full. These factors are rough rules of thumb and live in `actions.json`.

**Simplifications.** Checking assumes the hand is checked through to the next card at the realized equity, rather than modeling a bet behind. After an opponent raises the hero's bet, the hero is assumed to either call all-in or fold, whichever is worth more.

### Verdicts

Every legal action and preset size is scored, and the hero's choice is compared with the best:

- ✅ correct when it loses at most max(0.25bb, 4% of the pot) against the best option;
- 👍 playable when it loses at most max(1bb, 15% of the pot);
- ⚠️ mistake otherwise.

Thresholds scale with the pot so that tiny differences in big pots are not called mistakes. Close spots can change verdict when `actions.json` is tuned.

## Multiway pots

With two or more opponents still in:

- Each opponent's range is narrowed separately from their own actions.
- Opponents are assumed to respond to the hero's bet **independently**. The EV sums over every subset of opponents who call, with equity against exactly that subset. In real games a call from one player makes the next one tighter; the model ignores that.
- If any opponent raises, the hero is assumed to fold. This understates the value of very strong hands slightly and keeps the arithmetic tractable.
- Equity against two or more ranges uses Monte Carlo sampling in a Web Worker.

## Practice levels

- Level 1 stops at the flop. Level 2 checks down the turn and river.
- Level 6 deals hands that reach the river with a medium-strength hero hand. The earlier streets are played automatically by the same bots, and only the river decision is graded.
- "Practice my leaks" only steers which preflop spot a hand starts from. It does not construct specific postflop situations.

## Session tracking

- Results are real chip results of the hands as dealt, so short-term profit and loss is mostly variance. Verdicts and leaks are the better guide.
- A leak is marked fixed after its spot recurs and is played without a mistake, so one good repetition can mark it fixed. It reopens if it shows up again.
- Sessions are stored in this browser's local storage only.

## Coach voice (optional)

When switched on in Settings, Claude rewrites the trainer's feedback in a coaching voice. It is a presentation layer only: it receives the facts already on the feedback panel, never the opponents' cards or the hand's outcome, and any reply containing a number not in those facts is discarded. Nothing in the grading depends on it.

## Known gaps

- No solver: mixed strategies postflop are not reproduced, and the model has no notion of balancing a range across bets and checks.
- Hand classes ignore blockers within a class and the texture of future cards beyond draw and realization factors.
- Bet sizing for the hero is graded among preset sizes plus any custom size played; sizes the hero did not consider are not searched.
- Opponents do not adapt to the hero over a session.
