# Spec coverage

How each part of the original brief maps to the code and to the checks that guard it. Paths are relative to `src/`. "Smoke" means the browser smoke test (`scripts/smoke.mjs`), which CI runs on every pull request alongside the typecheck and unit tests.

## 1-2. Core loop

| Requirement | Where | Checked by |
|---|---|---|
| Deal a scenario up to an interesting hero decision | `engine/preflop/scenario.ts`, `engine/game/levels.ts` | `preflop.test.ts` (rarely deals clear folds), `flow.test.ts` |
| Range read before every decision | `ui/play/RangeReadPanel.tsx`, `ui/spots/PostflopPanels.tsx` | `flow.test.ts` (every hero turn has a read or an ungraded fallback), smoke |
| Legal actions, preset sizes, all-in, custom size | `engine/hand.ts` (`legalActions`), `engine/sizing.ts`, `ui/table/ActionBar.tsx` | `hand.test.ts`, `sizing.test.ts`, smoke (random clicks every turn) |
| Feedback after each decision | `ui/play/FeedbackPanel.tsx`, `PostflopFeedbackPanel` | `coach.test.ts` (preflop grading), `postflop.test.ts`, smoke |
| Opponents act from their range and profile, street by street | `engine/preflop/policy.ts`, `engine/postflop/bot.ts` | `game.test.ts` (bots follow the model; the read always holds the real hand) |
| Hand result: winner, showdown hands, verdict table, takeaways | `ui/play/HandResult.tsx` | smoke |
| Session tracker updates, then the next hand | `engine/session/session.ts`, `ui/session/` | `session.test.ts`, smoke (session rows equal hands played) |

## 3. Screen layout

| Requirement | Where | Checked by |
|---|---|---|
| Oval table, clockwise seats, badges, dealer button, hero at bottom, aggressor outlined | `ui/table/TableView.tsx`, `ui/table/view.ts` | smoke (9 seats at 9-handed) |
| Board with newest card highlighted, pot, blinds | `ui/table/TableView.tsx`, `ui/PlayingCard.tsx` | smoke |
| Hero strip with spot-dependent stat tiles | `ui/table/HeroStrip.tsx` | smoke |
| Action timeline ending in "You ?" | `ui/table/Timeline.tsx` | smoke |
| 380px with no horizontal scroll; light and dark | CSS under `ui/` | smoke (fails on any horizontal scroll, runs 380px light and 1280px dark) |

## 4. Range read

| Requirement | Where | Checked by |
|---|---|---|
| Opponent line, range in standard notation | Preflop: `formatRange`. Postflop: `summarizeRange` in `engine/range.ts` | `range.test.ts` (round trip), `rangeText.test.ts` (text matches the grid), smoke |
| What the latest action added or removed | Preflop crossed-out cells; postflop `stepLine` in `engine/postflop/coach.ts` | `multiway.test.ts` (crossed-out cells) |
| Low-stakes tendency / opponent style | `data/preflop/lowstakes.json`, `data/postflop/profiles.json` | `preflop.test.ts`, `game.test.ts` (styles differ as named) |
| Multiway: one panel per opponent, interaction note | `MultiwayReadPanel`, `interactionNote` in `engine/postflop/multiway.ts` | `multiway.test.ts` |
| Folded players on one line | `RangeReadPanel`, `PostflopReadPanel`, `MultiwayReadPanel` | smoke |
| Hero line: capped or uncapped, blockers, nut advantage | `heroLineRead` in `engine/preflop/coach.ts`, `postflopHeroLine` in `engine/postflop/heroRange.ts` | `heroRange.test.ts`, `flow.test.ts`, smoke |
| 13x13 grid colored relative to the hero, crossed-out cells, hero hand highlighted, tap for combos | `ui/play/CategoryGrid.tsx`, `engine/categories.ts`, `engine/postflop/categories.ts` | `range.test.ts` (grid layout), `postflop.test.ts` (each combo in one category) |
| Summary tiles and decision threshold | `RangeReadPanel`, `Summary` in `PostflopPanels.tsx` | smoke |
| "What the read tells you" nudge | `nudge` (preflop), `postflopNudge`, `multiwayNudge` | smoke |
| Combo table with card-removal reasons | `engine/postflop/combos.ts`, `ui/spots/ComboTable.tsx` | `multiway.test.ts` (matches the grid, explains removal) |

## 5. Engine

| Requirement | Where | Checked by |
|---|---|---|
| 6-max default, 6-9 handed with adjusted positions | `engine/positions.ts`, `chartSeat` | `preflop.test.ts` (7-9 handed chart seats), `flow.test.ts` at 7, 8 and 9 handed |
| Blinds, legal actions, min-raises, all-ins, side pots | `engine/hand.ts` | `hand.test.ts` (including a fuzz test of random play) |
| Hand evaluator | `engine/evaluator.ts` | `evaluator.test.ts` (against a brute-force evaluator) |
| Card removal in every combo count | `engine/range.ts` | `range.test.ts`, `multiway.test.ts` |

## 6. Ranges and strategy model

| Requirement | Where | Checked by |
|---|---|---|
| Preflop charts as JSON with a low-stakes layer | `data/preflop/`, `engine/preflop/charts.ts` | `preflop.test.ts` |
| Postflop narrowing by hand class with weights | `engine/postflop/classify.ts`, `model.ts`, `narrow.ts`, `data/postflop/actions.json` | `postflop.test.ts`, `game.test.ts` (narrowing never loses weight) |
| Hero recommendation with best action, acceptable set, reasons | `engine/postflop/recommend.ts`, `engine/preflop/coach.ts` | `postflop.test.ts` (EV and verdicts) |
| Labeled as approximate | "Approximate GTO charts" and "Approximate model" tags on the read; `docs/model.md` | smoke |

## 7. Math

| Requirement | Where | Checked by |
|---|---|---|
| Monte Carlo equity in a Web Worker, multiway equity | `engine/equity.ts`, `workers/` | `equity.test.ts`, `multiway.test.ts` (against exact enumeration) |
| Pot odds, break-even fold %, EV by size, SPR | `engine/math.ts`, `ui/spots/EvTable.tsx` | `math.test.ts`, `postflop.test.ts` |
| Grid categories match the range text; pot and stacks balance | `engine/categories.ts`, `engine/range.ts`, `engine/hand.ts` | `coach.test.ts` (preflop grid vs text), `rangeText.test.ts` (postflop), `hand.test.ts`, `game.test.ts` |

## 8. Feedback and grading

| Requirement | Where | Checked by |
|---|---|---|
| Verdict badge and a heading that names the decision | `gradePreflop`, `gradePostflop` | `coach.test.ts`, `postflop.test.ts` |
| Bullets tied to the read, equity check | `preflopFeedback`, `postflopFeedback` | `coach.test.ts`, `explain.test.ts` (every number in the prompt is on screen) |
| Which hands in the hero's range take each action | Preflop `StrategyGrid.tsx`; postflop `rangeActions` in `engine/postflop/heroRange.ts` | `heroRange.test.ts`, `flow.test.ts`, smoke |
| Close alternatives, sunk cost, results-oriented thinking | `postflopFeedback`, `preflopFeedback`, `HandResult` takeaways | `postflop.test.ts` (verdict margins), `session.test.ts` (sunk-cost leak tag) |
| Optional Claude coach voice that only uses computed numbers | `engine/coach/explain.ts`, `ui/coach/` | `explain.test.ts`, smoke (no request while off; invented numbers hidden) |

## 9-11. Opponents, scenarios, session

| Requirement | Where | Checked by |
|---|---|---|
| Hole cards sampled from the range at the start | `redeal` in `engine/game/levels.ts`, `engine/preflop/scenario.ts` | `game.test.ts`, `preflop.test.ts` |
| Profiles shown as seat tags | `data/postflop/profiles.json`, `ui/table/view.ts` | `game.test.ts` |
| Hand-built postflop practice spots whose lesson matches the model | `engine/postflop/spots.ts`, `ui/spots/SpotsScreen.tsx` | `postflop.test.ts` (each spot grades the way its lesson says), smoke (every spot renders) |
| Six curriculum levels | `LEVELS` in `engine/game/levels.ts` | `flow.test.ts`, `game.test.ts`, smoke (every level) |
| Leak tags and leak-targeted practice | `gradePreflop`, `gradePostflop`, `biasedMix`, `engine/game/drills.ts` | `session.test.ts`, `drills.test.ts`, `flow.test.ts` (every leak open), smoke |
| Running P/L, hand table, leaks fixed, saved sessions | `engine/session/session.ts`, `ui/session/` | `session.test.ts`, smoke (sessions survive a reload) |
| 40bb and 200bb stacks with depth-adjusted charts and sizes (beyond the brief) | `data/preflop/depth.json`, `chartDepth` and `getStrategy` in `engine/preflop/charts.ts`, `chartRaiseTo` in `engine/preflop/spot.ts` | `depth.test.ts` (each rule applies; strategies stay valid; reads hold the real hand), `flow.test.ts` (every level at both depths), smoke (seat stacks and play at both depths) |
| Opponent ranges defend near the minimum defense frequency against bets and raises (beyond the brief) | `rangeDefense` in `engine/postflop/model.ts`, `defend` and `maxBoost` in `data/postflop/actions.json`, `botPostflopAction` in `engine/postflop/bot.ts` | `defense.test.ts` (the floor; how often betting and raising grade best), `postflop.test.ts` (practice spots), `depth.test.ts` and `game.test.ts` (reads hold the real hand) |
| Adaptive opponents that adjust to the hero's postflop tendencies (beyond the brief) | `engine/session/adapt.ts`, `data/postflop/adapt.json`, `profileOf` in `engine/game/levels.ts` | `adapt.test.ts` (the grades follow each adjustment), `game.test.ts` (adjusted reads hold the real hand), smoke (session, Play note, opponent panels) |
| Importing and grading real hand histories (beyond the brief) | `engine/session/import.ts`, `engine/session/sampleHands.ts`, `ui/session/ImportScreen.tsx` | `import.test.ts` (sample hands rebuild exactly, skips give reasons, trainer hands round-trip through PokerStars text), smoke (sample hands import, save and replay) |
| Optional rake: 5% capped at 3bb, no flop no drop, counted in the postflop EV (beyond the brief) | `Rake`, `rakeOf`, `rakeKeep` and settlement in `engine/hand.ts`, `afterRake` in `engine/postflop/recommend.ts`, `engine/postflop/multiway.ts`, the Rake setting in `ui/play/GameScreen.tsx` | `rake.test.ts` (rake per pot, side pots, chips balance over random hands, replays, EV never higher with the rake), smoke (play with the rake on) |
| Installable app that works offline (beyond the brief) | `public/manifest.webmanifest`, `scripts/sw-plugin.ts`, `ui/app/install.ts`, the install panel in `ui/coach/SettingsScreen.tsx`, `.github/workflows/pages.yml` | smoke (manifest and icons load, Chromium installability check, a hand played offline) |
| Progress charts across sessions: mistake rate, EV given up, leaks (beyond the brief) | `engine/session/progress.ts`, `ui/session/ProgressPanel.tsx`, `lossBB` on each postflop decision record | `progress.test.ts`, smoke (panel, line, bar, tooltip and table after play) |
| Hand replay with opponents' cards and the read at each decision (beyond the brief) | `engine/session/replay.ts`, `ui/session/ReplayView.tsx` | `replay.test.ts` (rebuilt hands match the played ones), smoke (every hand replays) |

## Deliberate limits

These are documented in [model.md](model.md): no solver, no antes, rake only as an optional 5% capped at 3bb with unchanged preflop charts, and stack depths of 40bb, 100bb and 200bb only, with the 40bb and 200bb charts adjusted from the 100bb ones.
