# Changelog

Each milestone was merged as its own pull request.

## Unreleased

- Moved the rule for whether the hero has a decision into the engine (`heroDecides`), and added a test that plays random hands on every level, including custom bet sizes. It checks that every hero turn can be read and graded or ends the hand cleanly. The test fails on the level 1 bug fixed in milestone 7.
- The Play screen now falls back to an ungraded action bar if a hero turn has no range read, so a turn can never be left without buttons.
- Added a browser smoke test (`npm run smoke`) and a CI workflow that runs the typecheck, unit tests and smoke test on every pull request.
- Rewrote the README, and added this changelog and [docs/model.md](docs/model.md).

## Milestone 7: session tracker and curriculum ([#6](https://github.com/ShawnR2424/poker-coach/pull/6))

- Added a Session tab with:
  - running profit and loss in dollars and big blinds, bb per 100 hands, and the verdict split;
  - every hand with its spot, verdicts, result and main lesson;
  - a leak table.
- A leak is marked fixed when its spot comes up again and is played without a mistake, and reopens if it recurs.
- "Practice my leaks" weights new hands toward the preflop spots where open leaks show up.
- Level 6 (thin value and bluff-catching) plays the earlier streets automatically and stops at a river decision with a medium-strength hand.
- The Play screen shows running session totals and offers the next level after 20 decisions with at least 70% non-mistakes.
- Sessions persist in local storage, and earlier sessions stay viewable.
- Fixed: level 1 hands where the hero acted first on the flop showed "Your turn" with no buttons.

## Milestone 6: multiway pots and the combo table ([#5](https://github.com/ShawnR2424/poker-coach/pull/5))

- Level 5 keeps two opponents in, from an open with two callers or a squeeze spot.
- Multiway decisions show:
  - one range read per opponent;
  - a note on how their actions interact;
  - equity against all of them.
- Bet EV treats each opponent's response as independent: everyone folds, some subset calls, or someone raises (the hero then folds).
- Every postflop read has a combo table, open by default on rivers and in 4-bet pots.
- Grid cells that mostly drop out with an opponent's latest action are crossed out.

## Milestone 5: full hands ([#4](https://github.com/ShawnR2424/poker-coach/pull/4))

- Levels 2 (preflop and flop), 3 (full hands heads-up) and 4 (3-bet and 4-bet pots).
- Opponents play postflop from the same model used to narrow their ranges.
- Four editable opponent styles in `data/postflop/profiles.json`.
- Hands end at showdown with a review of every decision.

## Milestone 4: postflop EV and verdicts ([#3](https://github.com/ShawnR2424/poker-coach/pull/3))

- Postflop hand classes and exact per-combo equity, computed in a Web Worker.
- An opponent response model in `data/postflop/actions.json`.
- EV for every legal action and size.
- Verdicts:
  - ✅ correct when the action is within max(0.25bb, 4% of the pot) of the best EV;
  - 👍 playable when it is within max(1bb, 15% of the pot);
  - ⚠️ mistake otherwise.
- Leak tags, and sizing, sunk-cost and results-oriented feedback.
- The Postflop spots tab with four practice spots.

## Milestone 3: preflop ([#2](https://github.com/ShawnR2424/poker-coach/pull/2))

- Editable 6-max 100bb preflop charts with a low-stakes adjustment layer.
- Level 1 practice: generated spots that stop at a real decision.
- A range read per opponent, graded against chart frequencies with computed equity and pot odds.

## Milestone 2: table UI ([#1](https://github.com/ShawnR2424/poker-coach/pull/1))

- The table, seats, hero strip, action timeline and action buttons with preset and custom sizes.
- Verified at phone and desktop widths in light and dark themes.

## Milestone 1: engine

- Deck, 5-7 card evaluator, betting rules (minimum raises, short all-ins, side pots, uncalled bets), range notation, card removal, equity (exact heads-up postflop, Monte Carlo otherwise) and pot math.
- The Engine lab page.
