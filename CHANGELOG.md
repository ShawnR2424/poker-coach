# Changelog

Each milestone was merged as its own pull request.

## Table sizes and stakes

- The Play screen sets the table size (6-max, or 7, 8 or 9 handed) and the stakes ($0.25/$0.50 or $0.50/$1). Both are remembered in the browser.
- New early-position preflop charts for 7-9 handed: open-raise ranges for the seats before the LJ (`EP1` to `EP3`), responses to an early open (`_vs_EP`), and 3-bet defense after an early open (`EP_vs_IP`, `EP_vs_blinds`). The LJ and later seats use the 6-max charts for the seat with the same players behind.
- Practice hands are generated for any table size and blinds.
- Fixed: if the chosen opponent folded before the flop while someone else stayed in (for example the hero limped and the BB checked its option), the next hero turn had no opponent to read. Whoever is still in now becomes the opponent.
- The hand-flow test now also plays every level at 7, 8 and 9 handed at $0.50/$1, and the smoke test plays a 9-handed table in the browser.

## Milestone 8: optional Claude coach voice ([#8](https://github.com/ShawnR2424/poker-coach/pull/8))

- A Settings tab with an opt-in coach voice, off by default. With the player's own API key, saved only in the browser, each graded decision also gets a short explanation written by Claude Opus 5.5.
- The request carries only facts the feedback panel shows: the spot, the hero's cards and action, the verdict, the trainer's reasons, the EV table and the key concept. Opponents' cards and the hand's outcome are never sent.
- A reply with any number the trainer did not compute is not shown, and the trainer's own explanation stays on screen either way.
- The Claude SDK loads only when the coach voice is on, so the main bundle does not grow.
- Tests check the prompt against real decisions from several levels; the smoke test checks that nothing is sent while the feature is off, and checks both reply outcomes against a mocked API.

## Hardening and documentation ([#7](https://github.com/ShawnR2424/poker-coach/pull/7))

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
