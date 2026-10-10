# How the trainer models the game

Poker Coach grades decisions with exact arithmetic (equity, pot odds, expected value) applied to an approximate model of how opponents play. This page describes that model and its limits, so you know which numbers to trust as exact and which are estimates.

## Scope

- No-Limit Hold'em, 6 to 9 handed, $0.25/$0.50 or $0.50/$1 blinds, every stack 40bb, 100bb or 200bb at the start of each hand (100bb by default). The stakes change the dollar amounts only: in big blinds every spot plays the same.
- No rake by default; the Rake setting adds 5% of each pot that sees a flop, capped at 3bb (see [Rake](#rake)). No antes, no straddles, no deeper or shorter stacks.
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
- **Stack depth.** At 40bb or 200bb, `data/preflop/depth.json` adjusts every chart before the low-stakes layer, for the hero, the opponents and the baseline read alike. Each rule moves a share of one action's weight to another for a list of hands, as the low-stakes rules do, and says why in the feedback. At 40bb small pairs and suited connectors open, call opens and call 3-bets less often, strong hands 3-bet and 4-bet more instead of calling, opens shrink to 2.2bb, 3-bets and squeezes to 0.9 times their size, and every 4-bet is all-in, so facing a 4-bet the only choices are call or fold. At 200bb small pairs, suited connectors and suited aces call opens and 3-bets more often, QQ, JJ and AKo call a 3-bet more often instead of 4-betting, marginal hands fold to a 4-bet more often, and 3-bets, squeezes and 4-bets are 1.1 times their size. The chart used is the nearest of the three: 40bb up to 60bb, 200bb from 150bb. These are estimates of how the strategies shift, not separate solutions.
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

### Range text

Before the flop an opponent's range is written exactly, since chart weights are whole hand classes. After the flop the narrowed weights differ combo by combo, so the read writes an approximation instead. For each hand class it takes the share of the class's live combos (board and hero's cards removed) that is still in the range, relative to the class with the highest share. Classes at half of that or more are listed as the hands the range "still holds most of"; classes from 15% to half are listed as "some of". Classes below 15% are left out of the text but still appear in the grid. The relative scale matters because several streets of narrowing leave every class at a small absolute weight.

### Opponent behavior

`data/postflop/actions.json` gives, for each class:

- how often it bets small or big when first to act or checked to;
- how often it continues facing a bet, as a straight line that falls as the bet grows relative to the pot;
- what share of continuing hands raise;
- how much less often it continues when it bet and now faces a raise. One-pair hands give up somewhat more often against a raise than against a bet, but players at these stakes rarely fold a pair to a single raise, so turning a pair into a bluff-raise rarely beats calling;
- how it responds to an overbet. Past 1.5 times the pot the straight line stops: hands that barely mind bet size (sets, two pair, overpairs, good top pairs) keep calling a huge overbet or shove at close to their rate against a big bet, while weak pairs, draws and air give up.

On top of the per-class numbers, a whole range facing a bet or a raise defends at least the minimum defense frequency, 1 / (1 + f) for a bet of f times the pot, moved by the opponent's style (`continueAdd`): a nit still folds more than that and a calling station defends more (`rangeDefense` in `src/engine/postflop/model.ts`, `defend` and `maxBoost` in `actions.json`). The class table alone lets a wide range fold far too much: a range that checked is full of air and weak pairs, and a range of small bets holds many bluffs, so betting or raising with nothing would always show a profit. When the table falls short of the floor, every class's continue chance is multiplied by the same factor, at most three times its own and never past always, until the range reaches it. Pairs and draws take up the extra defense while air keeps folding, so a polarized range of strong hands and air can stay below the floor. The floor applies everywhere the tables do: the EV of each option, the range narrowing after a call or raise, the hero's own range split, and the bots, which compute it from the same range read the trainer shows.

`data/postflop/profiles.json` scales those numbers for four opponent styles: regular, nit, calling station and aggressive. All of these values are estimates of a typical low-stakes pool, not measured from hand histories or taken from a solver.

The same tables do two jobs. They narrow an opponent's range after each action they take, and they predict how the opponent responds to the hero's bets. The bots also act from them, so the range the trainer shows always contains the opponent's real hand.

### Adapting to the hero

With "Opponents adapt to me" on (the default), each new hand starts from the hero's latest 40 graded postflop decisions of each kind in the current session (`src/engine/session/adapt.ts`, thresholds in `data/postflop/adapt.json`):

- **Folding to a bet**: how many of the hero's decisions facing a bet were folds, next to how many the trainer's best play folded in the same spots.
- **Betting when nobody has bet**: the same for bets when the hero could check.

The comparison is with the best play rather than a fixed "normal" rate, because how often folding or betting is right depends on the spots that came up. Once a rate has at least 10 decisions behind it and the hero's count differs from the best play's by more than 20% of those decisions, every opponent adjusts for the hands that follow:

| Hero tendency | Opponents | Change |
|---|---|---|
| Folds to bets more than the best play | Bluff more | Air and weak draws bet and raise 1.8 times as often |
| Folds to bets less than the best play | Bluff less | Air and weak draws bet and raise 0.4 times as often |
| Bets more than the best play | Call the hero's bets lighter | One-pair hands, draws and air continue 10 points more often |
| Bets less than the best play | Give the hero's bets credit | One-pair hands, draws and air continue 10 points less often |

The adjusted style is used everywhere the base style was: the bots' actions, the range read, and the EV of each option. So the grades follow the adjustment. In a seeded sample of 600 level 3 hands, folding was the best response to a bet in 76 of 281 decisions against unadjusted opponents, 55 of 334 when they bluff more and 97 of 250 when they bluff less. Checking was best in 278 of 981 decisions with no bet to face, 326 of 1,014 when opponents call lighter and 202 of 949 when they give the hero's bets credit. A hero who keeps folding is pushed toward calling, and the opponents move back once the hero's rates come back in line. Each hand's replay keeps the adjustment it was played under.

### Expected value

EV is measured against folding now, so chips already in the pot are sunk. With `P` the pot before the hero acts, `eq` the hero's equity, `R` the share of it the hero realizes and `c` what the opponent adds to call:

| Action | EV |
|---|---|
| Fold | 0 |
| Check | `R·eq·P + L(P)` |
| Call | `R·eq·(P + c) − c + L(P + c)` |
| Bet or raise to `b` | the weighted sum, over every combo in the opponent's range, of fold `·P`, call `·(R·eq·(P + b + c) − b + L(P + b + c))` and raise `·max(call the shove, −b)` |

Each combo's response comes from its class, and the hero's equity is taken combo by combo, so a bet that only gets called by better hands shows that.

**Later streets.** `L(pot)` is what the hero adds on the streets still to come when the hand goes on with that pot: on the flop two more bets, on the turn one, each two-thirds of the growing pot and capped by the stacks. Against each opponent hand the hero beats more often than not, the hero wins `(2·eq − 1)` of those bets times the chance that hand calls a bet that size. Hands that are behind are assumed to give up rather than pay off, so `L` is never negative, and it is zero once the hand is all-in or on the river. Without it, a shove that gets the whole stack in now could outscore a normal bet whose value comes later. With more than one opponent in, the value against each is scaled down by how much the others cut the hero's equity.

**Realization.** Before the river, raw equity is scaled by how much of it a hand tends to realize: 95% in position and 85% out of position, times a class factor (draws and very strong hands realize more, weak pairs and air less). On the river, or once all-in, equity is realized in full. These factors are rough rules of thumb and live in `actions.json`.

**Simplifications.** Checking assumes the hand is checked through to the next card at the realized equity, rather than modeling a bet behind. After an opponent raises the hero's bet, the hero is assumed to either call all-in or fold, whichever is worth more.

### Verdicts

Every legal action and preset size is scored, and the hero's choice is compared with the best:

- ✅ correct when it loses at most max(0.25bb, 4% of the pot) against the best option;
- 👍 playable when it loses at most max(1bb, 15% of the pot);
- ⚠️ mistake otherwise.

Thresholds scale with the pot so that tiny differences in big pots are not called mistakes. Close spots can change verdict when `actions.json` is tuned.

### Your own range

After the flop the hero's range is narrowed the same way as an opponent's: the preflop chart range for the hero's actions, then the class tables for each postflop action the hero took. Two things are built from it:

- **What your line says.** The last action decides capped or uncapped: a bet or raise keeps the range uncapped, a check or call caps it, because the model takes most of its strongest hands with a bet or raise. The nut-advantage line compares the share of two pair or better in the hero's range (the board removed, but not the hero's own cards, since opponents cannot see them) with the strongest opponent's (the hero's cards removed). Blockers are the share of the opponents' two pair or better combos that use one of the hero's cards, plus a note when the hero holds the ace of a suit with three or more cards on the board.
- **Which hands take each action.** Each class in the hero's range is split across the actions on offer using the same frequencies the opponents use: `firstToAct` or `leadIntoAggressor` when no bet is faced, `facingBet` when one is. This is how the model's typical player would play the hero's range, not a solver strategy, and it ignores which hands within a class are better or worse.

If the hero took a line the charts never take (for example an open limp from a seat with no limping range), the hero has no range and the trainer says so instead of showing one.

## Multiway pots

With two or more opponents still in:

- Each opponent's range is narrowed separately from their own actions.
- Opponents are assumed to respond to the hero's bet **independently**. The EV sums over every subset of opponents who call, with equity against exactly that subset. In real games a call from one player makes the next one tighter; the model ignores that.
- If any opponent raises, the hero is assumed to fold. This understates the value of very strong hands slightly and keeps the arithmetic tractable.
- Equity against two or more ranges uses Monte Carlo sampling in a Web Worker.

## Practice levels

- Level 1 stops at the flop. Level 2 checks down the turn and river.
- Level 6 deals hands that reach the river with a medium-strength hero hand. The earlier streets are played automatically by the same bots, and only the river decision is graded.
- "Practice my leaks" works on about half the new hands, picking an open leak in proportion to how often it has come up.
  - A preflop leak leans the mix of preflop spots toward the ones where it shows up.
  - A postflop leak (for example a missed value bet, overfolding or a donk bet into the preflop raiser) gets a drill hand on levels 2, 3, 4 and 6. The trainer plays the hero's earlier decisions with the bots' strategy, as level 6 does, and stops at the first decision where that leak's tag is one a wrong action would earn there, using the same grading as the feedback. Those earlier decisions are not graded. Level 6 drills only stop on the river, and level 5 (multiway) uses the spot mix only.
  - If no such decision turns up within a short search (some leaks, such as a sunk-cost call, need a lot of the stack already in the pot and are rare in single-raised pots), the hand falls back to the spot mix.

## Rake

- With the rake on, the house takes 5% of each pot, rounded down to the chip and capped at 3bb, when the flop has been dealt. A hand that ends before the flop pays none. Pots won without a showdown after the flop are raked. Chips only one player could win, such as an uncalled all-in excess, are not raked, and the rake is shared over the main and side pots in proportion to their size, with any odd chip from the main pot.
- After the flop, the EV of each option values every pot the hero can win after the rake comes out of it: a pot of P is worth P minus its rake. Value from later streets keeps 95% of each further chip while the pot is below the cap and all of it once the cap is reached, judged at the pot the hand goes on with. Folding is still worth zero, so the rake makes thin calls and thin value bets worth less and never makes any option worth more.
- The preflop charts are the same with and without the rake. A raked game favours slightly tighter play, mostly from the blinds, which the charts do not reflect.
- Imported hands are graded without the rake, since each site's rake differs; their results come from what the history says was collected, so they are after the site's rake.

## Session tracking

- Results are real chip results of the hands as dealt, so short-term profit and loss is mostly variance. Verdicts and leaks are the better guide.
- A leak is marked fixed after its spot recurs and is played without a mistake, so one good repetition can mark it fixed. It reopens if it shows up again.
- Sessions are stored in this browser's local storage only.

## Imported hands

- The Import tab reads hand histories in the text format PokerStars and GGPoker write: no-limit hold'em cash games with 3 to 9 players dealt in, posting only the two blinds, with amounts in $, € or £. Tournaments, heads-up hands, antes, straddles, dead blinds, run-it-twice and other games are skipped, each with its reason.
- Players are put in seat order clockwise from the small blind. A table with fewer than six players is played as 6-max with the missing early seats folding first ("empty seat" in the replay). This keeps every real seat's position and the number of players behind it, which is what the charts depend on. Heads-up hands are skipped because the hand engine always puts the small blind first after the flop, while heads-up the small blind is the button and acts last.
- Every action is checked against the hand engine; a history whose actions do not follow the betting order is skipped. The hero's decisions are graded exactly as at the practice table: preflop against the charts, after the flop against each opponent's range narrowed from their actions. Opponents are read as the regular style, since their real styles are unknown, and the depth of the charts follows the hero's stack.
- Opponents' cards the history did not show get stand-in cards so the replay can run. When such a hand reached a showdown, the stand-ins are chosen so the same players win as in the history. The replay hides these cards and never uses them for grading, since the read only uses the opponents' ranges.
- The result of an imported hand is what the history says the hero collected minus what they put in, so it is after rake, unlike practice hands. The amounts are shown in dollars whatever the currency.
- Imported hands are saved under their own level, so they never count toward a practice level's progress. Their leaks and postflop tendencies count like any other hand's: they steer leak-targeted practice, and adaptive opponents read them.

## Coach voice (optional)

When switched on in Settings, Claude rewrites the trainer's feedback in a coaching voice. It is a presentation layer only: it receives the facts already on the feedback panel, never the opponents' cards or the hand's outcome, and any reply containing a number not in those facts is discarded. Nothing in the grading depends on it.

## Known gaps

- No solver: mixed strategies postflop are not reproduced, and the model has no notion of balancing a range across bets and checks. The trainer names the single option with the highest EV as best, so where a solver would mix (a semi-bluff raise with a weak draw, a bet or check with middle pair), the best play leans to the aggressive option whenever it is slightly ahead. In a seeded sample of 300 level 3 hands, raising was best in 64 of 161 heads-up decisions facing a bet and checking in 102 of 434 with no bet to face, down from 89 of 159 and up from 50 of 405 before the defense floor; a solver would raise less and check more. Options within the correct margin are all graded correct, so this mostly affects which option the feedback names.
- The defense floor spreads the extra defense across classes in proportion to how often each already continues. A real defender adds the hands that do best against the bettor's range, so the calling range can be a little weaker than it should be.
- Hand classes ignore blockers within a class and the texture of future cards beyond draw and realization factors.
- Only 40bb, 100bb and 200bb charts exist, and the 40bb and 200bb ones are rule-based adjustments of the 100bb charts. Stacks are always equal at the start of a hand.
- Bet sizing for the hero is graded among preset sizes plus any custom size played; sizes the hero did not consider are not searched.
- Adaptive opponents only watch two postflop rates, adjust in fixed steps rather than in proportion to the gap, and adjust the same way on every street and board. They do not adapt preflop.
- The rake in later-street value is judged at the pot when the hand goes on, so a pot that crosses the cap on a later street is slightly over-raked in the estimate.
- Later-street value is a rough estimate: one bet per street, no bluffing or raising on later streets, and no runout dependence. Against a range that checked and is capped, an overbet shove can still grade best as a bluff; the model may overstate how often such a range folds.
