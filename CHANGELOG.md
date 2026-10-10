# Changelog

Each milestone was merged as its own pull request.

## Range quizzes

- New Quizzes tab. Each quiz deals a 6-max, 100bb line: an opponent opens and you call, or you open and they call or 3-bet and you call. You paint their range on the 13x13 grid (tap a hand, drag across a stretch, or use the keyboard), then a flop comes and you estimate your equity against that range with a slider.
- The range is scored against the chart the trainer's opponents play for that action, as the share of combos the painting and the range have in common, with hands played part of the time counted by their frequency. Since a painting is all or nothing per hand, the result also gives the best score any painting could reach, and the grade is against that. The grid then shows the true range shaded by frequency, with a ring on painted hands outside it and a dashed ring on hands it plays that were left out.
- The equity guess is scored against an exact enumeration of every turn and river, and shown on a 0 to 100% bar with the guess marked.
- Filters choose which lines to deal (opens, calls, 3-bets) and whether opponents use the low-stakes adjustments (on by default, as on the Play tab).
- A "How you're doing" panel averages the latest 20 quizzes: range match and its share of the best possible, whether you paint too wide or too tight, and the average equity miss and its lean. Scores are saved in the browser.
- New `quiz.test.ts` checks that every line deals from the right charts with a clean flop, the scoring by combos and frequency, that the best painting is found and never beaten, the bands, and the history. The smoke test paints by dragging and by keyboard, checks the range and equity results, and that the score survives a reload.

## Progress charts

- The Session tab has a Progress panel covering every saved session in the order they were played:
  - **Mistake rate**, a line of the share of mistakes over the latest 50 graded decisions after each hand, with a dashed line where each new session started.
  - **EV given up after the flop**, a bar per session of the big blinds of EV given up against the best play per 100 hands.
  - **Leaks by session**, a table of the six most frequent leaks with how often each showed up per 100 graded decisions in each session, shaded by frequency, and whether it is fixed now.
  - The same per-session numbers in a table, and a tooltip on each chart.
- Each postflop decision now records the EV it gave up against the best play, in big blinds, at the practice table and in imported hands. Hands saved before this change have no such record, so the EV chart counts each session from the first hand that has one.
- The charts draw at their real width, so their labels stay legible on a phone.
- New `progress.test.ts` checks session order, the mistake rate and its window, EV given up per 100 hands, and leaks by session on hand-built sessions. The smoke test checks the panel, the line, a bar for the session just played, the hover tooltip and the table after the hands it plays.
- Pages: the app is published at https://shawnr2424.github.io/poker-coach/ and redeployed on every merge to main.

## Install as an app

- The trainer is now a progressive web app. Opened from a web address, it can be installed to a phone's home screen or a computer's dock, opens in its own window, and works offline: hands, spots, sessions, replays and imports all run without a connection. The Claude coach voice still needs one.
- New `public/manifest.webmanifest` and app icons (a spade on the felt green, rendered from `public/icon.svg` by `scripts/icons.mjs`), with the theme colour and an Apple touch icon in `index.html`.
- A small build plugin, `scripts/sw-plugin.ts`, writes `sw.js` with the list of every file in the build. The service worker caches them all on the first visit and names the cache after the build, so a new build replaces the old cache. Pages load from the network first and fall back to the cached app offline; other files come from the cache. Requests to the Claude API are never cached.
- The Settings tab has an "Install as an app" panel with an install button when the browser offers one, instructions when it does not, and a note once the app is saved for offline use. In an embedded preview, where service workers are not allowed, the app works as before.
- New `.github/workflows/pages.yml` publishes the build to GitHub Pages on each push to main once Pages is switched on for the repository, and is skipped until then.
- The smoke test opens the build in a fresh browser, checks the manifest and that every icon loads, runs Chromium's own installability check, waits for the service worker to take control, then turns the network off, reloads and plays a hand.

## Rake

- The Play screen has a Rake setting: no rake (the default) or 5% of each pot capped at 3bb, a typical online cash-game rake. It is remembered in the browser.
- With the rake on, the hand engine takes it from every pot that sees a flop, including pots won without a showdown; a hand that ends before the flop pays none ("no flop, no drop"). Chips only one player could win are not raked, and the rake is shared over the main and side pots by their size. The hand result says how much the house took, and results, session profit and loss and replays are all after rake.
- The postflop best play counts the rake: every pot the hero can win is valued after the rake comes out of it, and value from later streets keeps 95% of each chip until the cap is reached. This applies heads-up and in multiway pots. In a seeded sample of 300 level 3 hands, the best play changed in 39 of 595 heads-up postflop decisions, mostly to a smaller bet or to checking instead of a thin bet, with a few calls becoming folds; the best option was worth 0.52bb less on average.
- The preflop charts are not adjusted for the rake. Imported hands are graded without it, though their results already come after the site's rake.
- New tests check the rake on a pot and at the cap, no flop no drop, a pot won without a showdown, side pots with an uncalled excess, that stacks plus rake always add up to the starting chips over 400 random hands, and that a raked hand replays to the same result. Others check that the rake never makes an option worth more, leaves folding at zero and never costs more than the cap, heads-up and multiway. The smoke test plays levels 3 and 5 with the rake on and checks the hand result shows the rake taken.

## Import your own hands

- A new Import tab reads hand histories pasted from PokerStars or GGPoker, or opened from a saved .txt file. Each no-limit hold'em cash hand with 3 to 9 players is rebuilt with the hand engine, and every decision the hero made is graded with the same charts and postflop model as the Play tab. A preview lists each hand's verdicts, result and lesson, the most frequent leaks, and every skipped hand with the reason.
- Graded hands can be saved as a new session or added to the current one. They then appear on the Session tab marked as imported, with leaks, verdict counts and a replay of each hand. Their leaks steer "Practice my leaks" on the Play tab, and adaptive opponents read their postflop tendencies.
- Tables with fewer than six players are played as 6-max with the empty early seats folding first, which keeps every real seat's position. Opponents' cards that the history did not show are hidden in the replay. Results come from what the history says was collected, so they are after rake.
- "Try sample hands" loads three sample histories and one heads-up hand that is skipped.
- Fixed: on a phone, the Earlier sessions table made the whole Session page scroll sideways. The new smoke test step found it.
- New tests check that the sample hands rebuild exactly (positions, stacks, board, shown cards, results after rake) and that each skipped hand gets its reason. A further test writes seeded trainer hands from levels 3 to 5 as PokerStars histories and checks that each imports back to the same actions and result. The smoke test imports the sample hands, saves them and steps through each replay.

## Opponents defend their ranges

- A whole range facing a bet or a raise now defends at least the minimum defense frequency, 1 / (1 + f) for a bet of f times the pot, adjusted by the opponent's style: a nit still folds more and a calling station defends more. Before, each hand class folded on its own, so a range that checked (mostly air and weak pairs) or a range of small bets (many bluffs) folded far too often, and betting or raising with nothing showed a profit almost everywhere.
- When a range falls short of the floor, every class continues more often by the same factor, up to three times its own rate. Pairs and draws take up the extra defense while air keeps folding, so a range of strong hands and air can still fold to a raise. The new `defend` and `maxBoost` values are in `data/postflop/actions.json`.
- The floor applies to the EV of each option, the range narrowing, the hero's own range split and the bots, which compute it from the same range read the trainer shows, so the read still always holds the opponent's real hand.
- In a seeded sample of 300 level 3 hands, raising is now the best response to a bet in 64 of 161 heads-up decisions, down from 89 of 159, and checking is best in 102 of 434 decisions with no bet to face, up from 50 of 405. Opponents fold to a 2.5x raise 29% of the time on average, against the 44% a pure bluff needs; before, it was 41%.
- Two practice spot answers changed with the new numbers: queens at a low stack-to-pot ratio can also shove, in line with the lesson about getting the money in, and checking back with nothing on the ace-high flop is now playable rather than a mistake, since the big blind defends more.
- New tests check the floor (a range that defends enough is left alone, a wide range reaches exactly the floor, air keeps folding, styles still differ) and lock in the rates: raising best less than 48% of the time facing a bet, checking best more than a sixth of the time with no bet to face, and folds to a 2.5x raise well below what a bluff needs.
- An attempt to also model the bet an opponent can make after the hero checks lowered the value of checking weak hands and made betting grade best more often, so it was left out; docs/model.md lists the remaining gap.

## Stack depths

- The Play screen has a Stacks setting: 40bb, 100bb (the default) or 200bb, remembered in the browser. Every seat starts the hand with that many big blinds.
- New `data/preflop/depth.json` adjusts the 100bb charts for 40bb and 200bb before the low-stakes layer, for the hero, the opponents and the range reads alike, with a note in the feedback for each change:
  - At 40bb, small pairs and suited connectors open, call opens and call 3-bets less often; strong hands such as TT-88, AQo and KQs 3-bet more instead of calling; QQ-TT and AK 4-bet more instead of calling, because a 4-bet is all-in; facing a 4-bet, raising is folded into calling, and TT-88, AQo, AJs and KQs call more often at the better price. Opens shrink to 2.2bb and 3-bets and squeezes to 0.9 times their size.
  - At 200bb, small pairs, suited connectors and suited aces call opens and 3-bets more often for their implied odds; QQ, JJ and AKo call a 3-bet more often instead of 4-betting; JJ, TT, AQs and AKo fold to a 4-bet more often. 3-bets, squeezes and 4-bets are 1.1 times their size.
- The key concept for facing a 4-bet now speaks to the stack depth. Replays rebuild the reads at the depth the hand was played.
- Postflop needs no new data: SPR, all-in options and later-street value already follow the real stacks. In a seeded sample of 400 level 3 hands, an all-in was the best play in 82 of 488 first-to-act decisions at 40bb, 50 of 554 at 100bb and 36 of 568 at 200bb.
- New tests check that 100bb charts are unchanged, that every depth rule applies and keeps each hand a valid split, the direction of each change, the raise sizes, and that hands at both depths finish with every opponent's real hand inside the read. The hand-flow test plays every level at 40bb and 200bb, and the smoke test plays levels 1, 3 and 4 at both depths.

## Adaptive opponents

- Opponents now adjust to how the hero plays after the flop. They compare the hero's latest 40 postflop decisions of each kind with the trainer's best play in the same spots. A hero who folds to bets much more often than the best play faces more bluffs, one who folds much less faces fewer, one who bets much more gets called lighter, and one who bets much less gets more folds. The thresholds and sizes of each change are in `data/postflop/adapt.json`.
- The adjusted style drives the bots, the range reads and the EV grading together, so the grades reward exploiting it. In a seeded sample of 600 level 3 hands, folding to a bet was best in 61 of 276 decisions against unadjusted opponents, 34 of 327 when they bluff more and 80 of 244 when they bluff less.
- The Play screen explains each adjustment with the counts behind it, each postflop opponent panel marks the adjusted style, and the Session tab has a "How opponents read you" table of the two rates next to the best play's. "Opponents adapt to me" on the Play screen switches it off, and is remembered in the browser.
- Each postflop decision record now keeps the hero's action and the best action, and each hand's replay keeps the adjustment it was played under.
- New tests cover the rates, when an adjustment starts, how it changes the opponents' styles, that each adjustment moves the grades the way it should, and that adapted opponents still hold their real hand inside the read. The smoke test checks the Session table, the Play screen note, the opponent panels and switching it off.

## Later streets in EV

- Postflop EV now counts what a hand that is ahead wins on the streets still to come: one bet per later street, from the opponent hands it beats, in proportion to how often each would call. Before, EV covered only the current street, so with deep stacks a 100bb all-in could outscore a normal bet and was graded the best play in about one in five first-to-act postflop decisions.
- Opponents now respond to overbets more realistically: past 1.5 times the pot, sets, two pair, overpairs and good top pairs keep calling a huge bet, while weak pairs, draws and air give up. Before, the straight-line formula had even overpairs folding to a shove.
- In a seeded sample of 600 level 3 hands, an all-in is now the best play in 70 of 755 deep-stacked first-to-act decisions, down from 150. Most of the rest are bluff overbets into ranges that checked.
- Three practice spot lessons changed with the new numbers: top pair facing a raise now calls, the set on a wet turn now raises big instead of shoving, and queens at a low stack-to-pot ratio can check without it being a mistake. The spot answer tests caught each one.
- New tests cover later-street value, overbet responses, a flopped set betting instead of shoving, and the share of deep-stacked decisions where an all-in grades best.

## Opponents call raises more realistically

- Opponents who bet and then face a raise now keep most of their pairs instead of folding them. Before, a player who bet folded about half their weak top pairs and most middle pairs to a single raise, so the trainer graded raising a bluff-catcher as best and calling as a mistake (for example, raising second pair against a small river bet). In a sample of 600 level 3 hands, raising was the best response to a bet in 194 of 289 decisions before and 156 of 291 after.
- The combo-draw practice spot now says calling and raising are close, since the cutoff's turn bet keeps most of its pairs against a raise.
- New tests check that a weak pair facing a small river bet is not told calling is a mistake, and that a player who bet keeps most of their pairs against one raise.
- docs/model.md now lists a known gap: EV covers one street, so a deep-stacked all-in can score above a normal bet.

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
