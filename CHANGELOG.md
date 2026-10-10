# Changelog

Each milestone was merged as its own pull request.

## Later streets in EV

- Postflop EV now counts what a hand that is ahead wins on the streets still to come: one bet per later street, from the opponent hands it beats, in proportion to how often each would call. Before, EV covered only the current street, so with deep stacks a 100bb all-in could outscore a normal bet and was graded the best play in about one in five first-to-act postflop decisions.
- Opponents now respond to overbets more realistically: past 1.5 times the pot, sets, two pair, overpairs and good top pairs keep calling a huge bet, while weak pairs, draws and air give up. Before, the straight-line formula had even overpairs folding to a shove.
- In a seeded sample, an all-in is now the best play in 23 of 272 deep-stacked first-to-act decisions, down from 50. Most of the rest are bluff overbets into ranges that checked.
- Three practice spot lessons changed with the new numbers: top pair facing a raise now calls, the set on a wet turn now raises big instead of shoving, and queens at a low stack-to-pot ratio can check without it being a mistake. The spot answer tests caught each one.
- New tests cover later-street value, overbet responses, a flopped set betting instead of shoving, and the share of deep-stacked decisions where an all-in grades best.

## More postflop practice spots

- The Postflop spots tab grows from four spots to twelve. The new ones: a c-bet with nothing on an ace-high flop, top pair facing a flop raise, a gutshot facing a pot-sized turn bet, an overpair facing a turn check-raise, a set on a wet turn, top pair with a weak kicker checked to on the river, a missed flush draw on the river, and an underpair facing a river overbet.
- Each spot now states the answer its lesson teaches: which actions can be best and which are mistakes. A test grades every spot with the model and fails if the model stops agreeing with the lesson, so tuning `actions.json` cannot quietly turn a spot's lesson wrong.

## Hand replay

- Each hand in the Session tab has a Replay button. The replay steps through the hand one action at a time with the table, board, timeline and every opponent's cards. Buttons jump to each of your graded decisions, marked with the verdict, and each decision shows what you chose, its leak tag and the opponents' ranges at that point.
- Each hand is saved as a compact record (seats, stacks, hole cards, board and actions, about 1-2 KB) and rebuilt with the hand engine, so the replay shows exactly what was played. The newest 500 hands keep their records, which keeps saved sessions well inside the browser's storage limit. Hands played before this change have no record and show no Replay button.
- The spec coverage page lists the replay under the session section.
- Tests replay hands at every level at 6-max and 9 handed and check them against the hand as played. The smoke test opens every hand's replay, steps through several from start to end and checks for horizontal scroll at both widths.

## Spec coverage page

- Added [docs/spec-coverage.md](docs/spec-coverage.md), which maps each section of the original brief to the code that implements it and the tests or smoke checks that guard it.

## Opponent ranges in notation after the flop

- Each opponent panel after the flop now writes the narrowed range in standard notation, as the preflop read does: the hands it still holds most of, then the ones it holds some of. Hands left at low weight stay in the grid but are left out of the text, and the panel says so.
- Tests check that the text is valid notation for exactly the hands it names, that it names nothing the grid leaves empty, and that it leaves out only low-weight hands. They run on every practice spot and on real decisions at every postflop level. The smoke test checks that every postflop opponent panel shows the text.

## Postflop leak practice

- "Practice my leaks" now covers postflop leaks too. For an open postflop leak, the trainer plays the hero's earlier decisions with its default strategy and deals the hand straight to a decision where that leak can happen: a checked-to-you spot with a strong hand for "missed value bet", a bet facing a hand worth continuing with for "overfolding", and so on. The leak-practice note says when earlier decisions were made for you, and those are not graded.
- Before, every leak only steered the preflop spot, so postflop leaks rarely got practiced and could stay open.
- The postflop range read now notes which players have folded, as the preflop read does.
- Tests check that each drill stops where its leak can actually be tagged and that the hand plays on normally from there. The hand-flow test plays every level with every leak open, and the smoke test plays hands with "Practice my leaks" switched on.

## Your range after the flop

- The postflop range read now has a "What your line says" section for the hero, as it already did before the flop. It says whether the hero's last action caps the range or keeps it uncapped, compares the share of two pair or better in the hero's range with the strongest opponent's, and says how many of the opponents' two pair or better combos the hero's cards block, including the nut flush blocker.
- Postflop feedback now shows which hands in the hero's range take each available action (fold, call or raise, or check, small bet or big bet), the hand types behind each, and where the hero's own hand falls. The frequencies come from the same class model the opponents use, and the panel says so.
- The nut-advantage numbers in the feedback now count the hero's range the way the opponents see it, without removing combos that use the hero's own cards.
- Tests cover the new read on every practice spot and on every postflop turn of the hand-flow test, at every table size; the smoke test checks both sections in the browser.

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
