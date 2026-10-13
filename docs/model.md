# How the trainer models the game

Poker Coach grades decisions with exact arithmetic (equity, pot odds, expected value) applied to an approximate model of how opponents play. This page describes that model and its limits, so you know which numbers to trust as exact and which are estimates.

## Scope

- No-Limit Hold'em, 6 to 9 handed, $0.25/$0.50 or $0.50/$1 blinds, every stack 40bb, 100bb or 200bb at the start of each hand (100bb by default). The stakes change the dollar amounts only: in big blinds every spot plays the same.
- No rake by default; the Rake setting adds 5% of each pot that sees a flop, capped at 3bb (see [Rake](#rake)). No antes, no straddles, no deeper or shorter stacks at the cash table; the separate Tournament tab covers short-stack push/fold with antes (see [Tournament mode](#tournament-mode)).
- One hero seat; the opponents are bots driven by the model below.

## What is exact

These are computed, not estimated, and the unit tests check them:

- Hand strength. A 5-7 card evaluator, checked against an independent brute-force evaluator.
- Betting rules. Minimum raises, short all-ins that do not reopen the action, side pots, uncalled bets returned.
- Card removal. Combos that use the hero's cards or the board are removed from every range before anything is counted.
- Equity. Exact enumeration heads-up from the flop on (and on the Equity tab, whenever the count is small enough). Monte Carlo preflop and in multiway pots, which matches exact enumeration to within 1% in the tests.
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

On top of the per-class numbers, a whole range facing a bet or a raise defends at least the minimum defense frequency, 1 / (1 + f) for a bet of f times the pot, moved by the opponent's style (`continueAdd`): a nit still folds more than that and a calling station defends more (`rangeDefense` in `src/engine/postflop/model.ts`, `defend` and `maxBoost` in `actions.json`). The class table alone lets a wide range fold far too much: a range that checked is full of air and weak pairs, and a range of small bets holds many bluffs, so betting or raising with nothing would always show a profit. When the table falls short of the floor, every class's continue chance is multiplied by the same factor, at most three times its own and never past always, until the range reaches it. Pairs and draws take up the extra defense while air keeps folding. When even that falls short, as for a capped range facing an overbet, the range calls down with its best hands first: sets and better, then two pair, overpairs, top pairs, middle and weak pairs and strong draws are raised toward always, in that order, until the floor is met, while weak draws and air keep folding. A range that is short of hands worth calling with can still fold more than the floor; this top-up applies to a bet, not a raise, since a range facing a raise has already shown strength. The floor applies everywhere the tables do: the EV of each option, the range narrowing after a call or raise, the hero's own range split, and the bots, which compute it from the same range read the trainer shows.

`data/postflop/profiles.json` scales those numbers for four opponent styles: regular, nit, calling station and aggressive. All of these values are estimates of a typical low-stakes pool, not measured from hand histories or taken from a solver, unless you import solver spots (see [Imported solver spots](#imported-solver-spots)).

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

### Mixed spots

Where a solver would mix, the trainer shows a mix too. For each kind of action (fold, check, call, bet, raise) it takes the best size, and every kind whose EV is within the correct margin of the best becomes part of the mix. Each part is weighted by `exp((EV − best EV) / (margin / 2))`, so options that tie split evenly and one a full margin behind gets about 12%, which rounds to 10% since the weights are rounded to 5% steps. Every part of a mix is graded correct, and the feedback names the whole mix with its EVs instead of a single best play.

The frequencies are a teaching heuristic that says how close the options are, not solver output: a solver mixes to keep a range balanced, which this model does not track. In a seeded sample of 300 level 3 hands, measured when the floor was added, 98 of 595 heads-up postflop decisions were mixed, almost all between two kinds of action (bet or check 66, call or raise 17, call or fold 11). Adaptive opponents count a mixed spot by its share, so checking in a 50/50 bet-or-check spot counts as half a check where the best play checks.

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
- With the rake on, everyone plays rake-adjusted preflop charts: the hero's recommendations, the opponents and the range reads alike. The layer in `data/preflop/rake.json` applies after the stack depth layer and before the low-stakes one. Because only pots that see a flop are raked, it taxes hands that make their money in small pots after the flop and leaves pots won before the flop alone:
  - The big blind defends fewer weak offsuit and low suited hands (60% of them fold), and 3-bets a quarter of its best calls (99-77, ATs, KJs, QJs, AJo, KQo) instead of flatting.
  - Cold calls in position with small pairs, suited connectors, weak suited aces, ATo and KJo fold 40% of the time.
  - The weakest steals from the cutoff, button and small blind fold 40% of the time; early-position opens do not change.
  - Over-limps behind limpers are halved.
  - 3-bet, 4-bet, squeeze and all-in charts do not change: those pots reach the 3bb cap quickly, so the rake costs them little.
  - At 100bb the button opens 42.9% of hands instead of 48.1%, the small blind 39.8% instead of 43.0%, and the big blind defends 39.8% instead of 50.7% against a button open and 41.3% instead of 54.1% against a small-blind open; UTG and hijack opens are unchanged.
- When the rake moved the chart's play with the hero's hand by 5% or more, the preflop feedback says so, with the reason.
- These are estimates of the direction and rough size of a rake's effect, not solver output for this exact rake.
- Imported hands are graded without the rake, since each site's rake differs; their results come from what the history says was collected, so they are after the site's rake.

## Session tracking

- Results are real chip results of the hands as dealt, so short-term profit and loss is mostly variance. Verdicts and leaks are the better guide.
- A leak is marked fixed after its spot recurs and is played without a mistake, so one good repetition can mark it fixed. It reopens if it shows up again.
- Sessions are stored in this browser's local storage only.
- The progress charts measure skill, not results. The mistake rate is over the latest 50 graded decisions, so it moves with the spots dealt as well as with play. EV given up is the gap between the chosen action and the best one at each postflop decision, by the same model that grades it, so it inherits the model's limits below; preflop decisions are graded against chart frequencies and add nothing to it.

## Range quizzes

- A quiz is a heads-up 6-max line at 100bb: an opponent opens and you call, or you open and they call or 3-bet and you call. The opponent's range is the chart the trainer's opponents play for that action, with the low-stakes adjustments when that option is on (the default, as on the Play tab). For a call it is the calling range only; hands they would 3-bet instead are not part of it. Your hand is dealt from your own chart for the line, so it is a hand you would really have there.
- The painting is all or nothing per hand, while charts play some hands part of the time. The match is the weighted overlap: combos in both ranges over combos in either, with a hand the range plays half the time counting half its combos. So a range full of mixed hands cannot be matched exactly. The trainer works out the best score any painting can reach (painting every hand played at least some share of the time; it tries each share) and grades your match against it. Opening ranges have no mixed hands, so their best is 100%; the median best is about 90% for calling ranges and 87% for low-stakes 3-bet ranges, with a few 3-bet ranges topping out near 74%.
- The equity is your share of the pot on the flop against the opponent's whole range for the line, before any flop betting, with card removal: every turn and river against every combo your cards and the flop leave possible. It does not narrow the range for flop actions, so it is equity, not EV.
- Quiz scores are stored in this browser only, separately from sessions, and do not affect leaks, adaptive opponents or level progress.

## Chart explorer

- The Charts tab reads the same charts and layers as the rest of the trainer (`chartStrategy`), so what it shows is exactly what the Play tab recommends or what the opponents play. "Yours" is the hero chart and "The opponents'" the pool chart; they differ only when the low-stakes adjustments are on.
- Changed hands are measured against the plain 100bb chart with no rake and no low-stakes adjustments, per hand class, and listed when any action's frequency moved by at least 1 point. The notes are the ones the adjustment rules in `data/preflop/` attach when they change a chart.
- Sizes are the chart sizes at that depth: an open in big blinds, a 3-bet as a multiple of the open, a 4-bet as a multiple of the 3-bet (all-in at 40bb), and an isolation raise in big blinds plus one per limper. On the Play tab they are rounded to the table's chips and capped by the stack.

## Imported charts

- An imported chart replaces the built-in chart with the same kind and key, for every reader: the hero's recommendations and grades, the opponents' choices, the range reads, quizzes, the chart explorer and the equity calculator's chart ranges. Only charts the trainer already has can be replaced, so every spot it deals still finds a chart and the hand generator is unchanged.
- An imported chart is taken as the 100bb chart. The stack depth, rake and low-stakes layers apply on top of it exactly as they do to the built-in chart, and the raise size defaults to the built-in size when none is given. At 40bb and 200bb this means the imported chart is adjusted by rules written for the built-in charts, not replaced by a solution at that depth.
- Opening charts stay raise or fold: an open limp leads to spots with no charts. Facing a 4-bet the raise is always all-in.
- Weights are per combo, so a pasted range can weight single combos (`AhKh:0.5`) as solvers export them. Grades, the chart explorer and the quizzes average a class's combos where they work per hand class.
- The charts are put in place when the app starts, and saving or removing an import reloads the app, so nothing built from the previous charts is kept. A saved import that no longer passes the checks is ignored and the built-in charts are used.
- Review cards dealt again after the charts change are graded with the charts in place now, not the ones the hand was played with.

## Imported solver spots

A solver strategy report gives each combo's action frequencies at one decision on one board. The postflop model works by hand class and does not depend on the board, so a report is boiled down to classes and the imported spots are averaged into the class tables (`src/engine/postflop/solverImport.ts`):

- **Reading a report.** Each row's combos are dealt out on the spot's board (combos that use a board card are dropped) and sorted into the ten hand classes. A row's frequencies are normalized to add up to one, and each combo counts with its weight: the weight or frequency column, a combos column divided among the hand's combos, or one when there is no weight column. A class's frequencies are the weighted average of its combos.
- **Bet sizes.** First to act, bets up to half the pot count as small and bigger bets, all-ins and bets with no size as big, matching how the model sorts bets. Facing a bet, any bet or all-in column counts as a raise.
- **First to act and leads.** A class's small and big bet shares are the weighted averages over every spot of that kind; they replace the class's `betSmall` and `betBig` in `firstToAct` or `leadIntoAggressor`.
- **Facing a bet.** Each spot gives a class's continue share (call plus raise) at one bet size. With two or more sizes, the class's straight line (`base` and `slope`) is fitted to them by weighted least squares, with the slope kept at zero or above. With one size the built-in slope is kept and the base moves so the line passes through the imported share. Bets above 1.5 times the pot, where the overbet rule takes over, are left out of the fit. The raise share is the class's raises divided by its continues over every facing-bet spot, overbets included.
- **Facing a raise.** Each spot's continue share is divided by what the class's line gives against a bet of the same size, and the weighted average replaces the class's `facingRaise.continue` multiplier.
- **What stays.** Classes and tables no imported spot covers keep their built-in values. The defense floor still applies on top; solver strategies usually defend enough already, so it rarely moves them. The imported numbers are the regular opponent's; the nit, calling station and aggressive styles still scale them by their multipliers, and adaptive opponents still adjust them to the hero.
- **Limits.** Averaging into classes loses what a solver gets from the board: a class plays the same on a dry king-high flop as on a wet connected one, and the turn and river use the same tables as the flop. Spots are best added for the boards and lines the trainer deals most. The hero's own range split (below) uses the same tables, so it moves with the import too.
- The tables are put in place when the app starts, and adding or removing spots reloads the app. The equity worker receives the tables with each multiway job, since it has no saved settings of its own. A saved pack that no longer passes the checks is ignored.

## Equity calculator

- Each player holds a weighted range; an exact hand is a range of one combo. Combos that use a board or dead card are removed first, and the combos column counts what is left (by weight).
- Exact when the count of hand deals times runouts times players is at most 4 million evaluations: every combination of the players' combos that shares no card, each weighted by the product of the combo weights, and every runout of the remaining deck. Two exact hands preflop (1.7 million runouts) and a hand against a few ranges on the flop are exact.
- Otherwise it samples: each player is dealt from their range by weight, and the whole deal is redealt if two players share a card, so the sample follows the same distribution as the exact count; the board is then completed at random. The margin shown is 1.96 standard errors of the least certain player's equity.
- Equity is a share of the pot: a split between k players gives each 1/k. Wins counts deals a player wins alone; splits counts deals they share.

## Tournament mode

- The Tournament tab is separate from the cash game model: its own spots, ranges and tally, with nothing shared with the Play tab's sessions, leaks or charts.
- A spot is a final table of 6 or 9 players, blinds 0.5/1 and, when on, a big blind ante of 1bb paid by the big blind. Your stack is 4bb to 15bb, where push/fold is the standard play; the others' stacks are 3bb to 40bb, weighted toward shorter stacks. In 60% of spots it is folded to you; otherwise a player in front of you is all-in. Hands whose two options are more than 3bb apart are often redealt, so most spots are close.
- Payouts: chip EV values every chip the same. The final table pays everyone (6 left: 38/24/16/10/7/5%; 9 left: 30/20/14/10/8/6/5/4/3%). The bubble pays all but one (6 left: 40/25/17/11/7%; 9 left: 30/20/15/11/8/6/5.5/4.5%). Under ICM (Malmuth-Harville), a player finishes first with probability equal to their share of the chips, the next place is shared the same way among the rest, and so on; a player who busts takes the lowest place left.
- The ranges are worked out in the browser for each table, by class (169 starting hands), from the all-in equity of each class against each other in `data/tournament/class-equity.json` (20,000 random deals per pair, card removal between the two hands). The callers answer the all-in range exactly, working back from the big blind so that each caller knows how the players after them answer. The opener's range moves toward its best answer to those calls by fictitious play over 150 passes, so hands on the edge end up mixed; frequencies under 5% or over 95% are rounded to never or always. Every player maximizes their own chips or prize money.
- Overcalls: after a call, each player behind may join with an overcall, so a pot can end three-way. Each overcall range moves toward its best answer by fictitious play alongside the opener's, and the call in front of it answers it exactly; an overcall range is within about half a big blind of its best answer at the edges. A three-way all-in has a main pot (with the blinds and ante) for the best hand and a side pot between the two bigger stacks. Its finishing order is estimated from the three head-to-head equities: each player wins in proportion to how often they beat both others, and the other two finish in their head-to-head order. A fourth player never joins.
- Simplifications: at most two players call the all-in; three-way equities are estimated from the head-to-head ones rather than dealt out; when the player who would open folds, the hand is treated as folded around to the big blind; equity is between hand classes, ignoring how the exact cards block other players' hands; and stacks are rounded to half a big blind. On the published heads-up equilibrium at 10bb with no ante, the trainer's small blind shoves 58% of hands and the big blind calls 37%, matching published values.
- Reshove spots: a player opens to 2bb, it is folded to you with 12bb to 25bb (the opener has 15bb to 40bb), and you go all-in or fold. The opener's range is the trainer's plain 40bb opening chart for its seat (at 9-handed, the early seats use the EP charts). The opener calls with its best answer to your all-in range, and your all-in range follows by fictitious play, as for push/fold. The players after you are assumed to fold to the all-in, and when you fold the opener is assumed to take the pot, so neither of them gets a later decision.
- Grading compares the two options in big blinds. Under ICM, a share of the prize pool is converted to big blinds at the average chip's value (the prize pool divided by the chips in play), so the margins are the same in every mode: correct within 0.15bb of the better option, playable within 0.5bb, a mistake beyond.
- For a call, the equity needed is where calling and folding are worth the same: (fold − lose) / (win − lose) in chips or prize money. It is the heads-up figure; when a player behind may overcall, the feedback says how often, and the values graded include those three-way pots. ICM raises it above the chip-EV number because chips lost cost more prize money than chips won add; that gap is the risk premium.

## Opponent stats

- Stats are kept per style, not per seat, because a practice hand assigns each opponent a style at random; the seat tag says which style is in which seat. They are read from the replays of the current session's practice hands, so they reset with a new session. Imported hands (every opponent plays the regular style there) and level 1 hands (no styles, no flop) are skipped.
- Only postflop play is counted. Before the flop every style plays the same pool charts and the table scripts the action to reach each level's spot (players not in the hand fold), so VPIP, PFR or 3-bet percentage would measure the hand generator, not the opponent.
- Fold to bet is the share of an opponent's postflop decisions facing a bet or raise that were folds. Bet or raise is the share of all its postflop decisions that were bets or raises.
- Each style is compared with the whole table (all styles together) rather than with fixed numbers, since how often anyone folds depends on the bets they face; a hero who bets big gets more folds from everyone. A rate shows after 12 bets faced or 20 decisions. A note needs the rate to differ from the table's by at least 12 points (fold to bet) or 9 points (bet or raise), and by at least two standard errors of the table's rate at that sample size, so a short run does not earn a note.
- In seeded samples of 900 practice hands at levels 3 to 5 with random hero play, the table folded to about 35-38% of bets and bet or raised about 20-22% of the time. The nit folded about 47-53%, the calling station about 15-20%, and the aggressive style bet or raised about 30-36% of the time; the regular sat near the table. The calling station also bets less (about 10-12%), but at these sample sizes that gap does not always reach the threshold.

## Mistake review

- Every decision graded a mistake, at the practice table, in an imported hand or in Tournament mode, becomes a card, newest first, up to 150 cards in the deck at once. The card keeps its own copy of the hand, so it lasts after the session drops the hand's replay.
- A card rebuilds the hand up to that decision and grades the new answer with the same charts, ranges and opponent styles (including any adaptive adjustments) the hand was played with, and the same feedback as the practice table. Imported hands use the regular style for every opponent, as when they were imported. If the charts or model have changed so that a spot can no longer be graded, the card says so and can be removed.
- Scheduling is a Leitner box system with five boxes. New cards are due at once. A correct answer moves a card up a box and brings it back after 1, 3, 7 and then 21 days; a correct answer in the last box marks it learned and takes it out of the deck. A mistake sends it back to the first box, due again 10 minutes later. A playable answer keeps its box and brings it back the next day, since it is close but not the play the card teaches.
- A tournament mistake becomes a card that saves the table (stacks, ante, payouts, opener, hero and hand) rather than its ranges. When the card is dealt, the ranges are worked out again; the solver is deterministic, so with an unchanged model they are the same ranges, and the first answer is graded the same way.
- Grading a card again uses today's model, so a spot whose grade has changed since it was played is graded by the current model. The deck is stored in this browser only and does not change leaks, adaptive opponents or level progress.

## Imported hands

- The Import tab reads hand histories in the text format PokerStars and GGPoker write: no-limit hold'em cash games with 3 to 9 players dealt in, posting only the two blinds, with amounts in $, € or £. Tournaments, heads-up hands, antes, straddles, dead blinds, run-it-twice and other games are skipped, each with its reason.
- Players are put in seat order clockwise from the small blind. A table with fewer than six players is played as 6-max with the missing early seats folding first ("empty seat" in the replay). This keeps every real seat's position and the number of players behind it, which is what the charts depend on. Heads-up hands are skipped because the hand engine always puts the small blind first after the flop, while heads-up the small blind is the button and acts last.
- Every action is checked against the hand engine; a history whose actions do not follow the betting order is skipped. The hero's decisions are graded exactly as at the practice table: preflop against the charts, after the flop against each opponent's range narrowed from their actions. Opponents are read as the regular style, since their real styles are unknown, and the depth of the charts follows the hero's stack.
- Opponents' cards the history did not show get stand-in cards so the replay can run. When such a hand reached a showdown, the stand-ins are chosen so the same players win as in the history. The replay hides these cards and never uses them for grading, since the read only uses the opponents' ranges.
- The result of an imported hand is what the history says the hero collected minus what they put in, so it is after rake, unlike practice hands. The amounts are shown in dollars whatever the currency.
- Imported hands are saved under their own level, so they never count toward a practice level's progress. Their leaks and postflop tendencies count like any other hand's: they steer leak-targeted practice, and adaptive opponents read them.

## Real-play report

- The report on the Import tab covers every imported hand in the saved sessions: the current one and up to 20 earlier ones (`src/engine/session/realPlay.ts`). Practice hands are left out, since their preflop action is scripted to reach each level's spot.
- VPIP counts hands where the hero called, completed the small blind or raised before the flop; PFR, hands where the hero raised. A 3-bet opportunity is a preflop decision facing exactly one raise the hero did not make; fold to 3-bet counts hands where the hero opened and then faced a re-raise. Saw flop counts hands that reached the flop without the hero folding. These are stored with each hand when it is imported, so they last after its replay is trimmed; hands imported before the report existed are read from their replay while they still have one.
- The win rate is the result in big blinds after rake, per 100 hands from 10 hands on. Results by seat use the same numbers.
- Grades by street count each decision's verdict. EV lost is the sum of each postflop decision's loss against the best play, in big blinds, the same number the feedback shows. Preflop decisions are graded against the charts, which carry no EV, so they count toward grades and leaks but not EV lost.
- Leaks are ranked by the postflop EV lost on the decisions that showed them, then by how often they showed. The costliest decisions are the five postflop decisions that lost the most EV and were not graded correct.

## Backup and restore

- A backup is one JSON file, `{ app: "poker-coach", v: 1, savedAt, data }`, where `data` holds each saved item exactly as the browser stores it: the sessions and hands, the review deck, quiz history, the tournament settings and tally, the table and level settings, the chart explorer and equity calculator fields, any imported charts, and the theme.
- The coach voice settings, which hold the Claude API key, are never written to a backup and are never read from one.
- A restore checks the version and every item first and changes nothing if any check fails. It then replaces the saved data: items in the file are written, and items the file does not have are cleared, so data from two browsers is never mixed. The page reloads so every tab reads the restored data.

## Coach voice (optional)

When switched on in Settings, Claude rewrites the trainer's feedback in a coaching voice. It is a presentation layer only: it receives the facts already on the feedback panel, never the opponents' cards or the hand's outcome, and any reply containing a number not in those facts is discarded. Nothing in the grading depends on it.

## Known gaps

- No solver: the built-in preflop charts and postflop tables are estimates unless you import your own (see [Imported charts](#imported-charts) and [Imported solver spots](#imported-solver-spots)), imported postflop play is averaged by hand class rather than kept per board, and the postflop model has no notion of balancing a range across bets and checks. Mixed spots (above) come from how close the EVs are, not from balance, so a spot a solver would mix can still show one play when one option's EV is clearly ahead, and the best play leans to the aggressive option whenever it is slightly ahead. In a seeded sample of 300 level 3 hands, measured when the floor was added, raising was best in 64 of 161 heads-up decisions facing a bet and checking in 102 of 434 with no bet to face, down from 89 of 159 and up from 50 of 405 before the defense floor; a solver would raise less and check more.
- The defense floor spreads the extra defense across classes in proportion to how often each already continues. A real defender adds the hands that do best against the bettor's range, so the calling range can be a little weaker than it should be.
- Tournament mode covers push/fold and reshoves over a 2bb open: no smaller raises, limps or calls of an open, at most two players call an all-in (with the three-way odds estimated from head-to-head equities), and the opener's range is a cash-game 40bb chart rather than a tournament one. Its payouts are fixed presets, not a real tournament's structure.
- Hand classes ignore blockers within a class and the texture of future cards beyond draw and realization factors.
- Only 40bb, 100bb and 200bb charts exist, and the 40bb and 200bb ones are rule-based adjustments of the 100bb charts. Stacks are always equal at the start of a hand.
- Bet sizing for the hero is graded among preset sizes plus any custom size played; sizes the hero did not consider are not searched.
- Adaptive opponents only watch two postflop rates, adjust in fixed steps rather than in proportion to the gap, and adjust the same way on every street and board. They do not adapt preflop.
- The rake in later-street value is judged at the pot when the hand goes on, so a pot that crosses the cap on a later street is slightly over-raked in the estimate.
- Later-street value is a rough estimate: one bet per street, no bluffing or raising on later streets, and no runout dependence. An overbet bluff against a capped range now grades best only rarely: in a seeded sample of 400 level 3 spots where a regular, aggressive or calling-station opponent had checked and the hero held under 35% equity with no draw, an overbet shove graded best in 1 of 88, down from 9 of 88 before the top-up. Against a nit it can still grade best, since a nit overfolds by design.
