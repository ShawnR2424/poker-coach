# Poker Coach

Poker Coach is a browser-based trainer for No-Limit Hold'em cash games with 100bb stacks by default, or 40bb or 200bb: 6-max by default, or 7 to 9 handed, at $0.25/$0.50 or $0.50/$1. You play the hero seat one decision at a time. Before each decision it shows what every opponent is likely to hold. After you act, it grades the decision with computed equity, pot odds and expected value, and explains the result.

> **Approximate GTO.** The preflop charts are static approximations and the postflop opponent model is a hand-class heuristic, not solver output. The trainer is built to teach sound reasoning (ranges, card removal, pot odds, sizing), not to reproduce a solver's exact frequencies. See [docs/model.md](docs/model.md) for what is modeled and what is not.

## Features

- **Range read before every decision.** Each opponent gets a 13x13 grid colored by how their hands fare against yours, a hand-class breakdown, and a combo table showing how many combos of each hand remain after card removal and which known cards removed the rest. Hands that drop out with an opponent's latest action are crossed out. After the flop, each opponent's narrowed range is also written in standard notation, split into the hands it still holds most of and the ones it holds some of. A "What your line says" note covers the hero's own range: whether the line so far caps it, who has the nut advantage, and which of the opponents' strongest hands the hero's cards block.
- **Graded decisions.** Preflop decisions are graded against chart frequencies. Postflop decisions are graded by the EV each legal action and size gives up against the best one. Feedback covers equity, pot odds, sizing ("right idea, wrong size"), sunk-cost and results-oriented thinking. After the flop it also shows which hands in the hero's range take each action, with the hero's own hand placed in it.
- **Full hands to showdown**, with opponents in four styles (regular, nit, calling station, aggressive) who act from the same model used to read their range. Opponents defend their whole range against bets and raises at about the minimum defense frequency for their style, so bluffing with nothing is not automatically the best play.
- **Adaptive opponents.** Opponents compare your postflop folds and bets with the trainer's best play in the same spots. If you fold to bets far more often, they bluff more; if you bet far more often, they call lighter; and the other way round. The Play screen says what they changed and why, the Session tab shows the rates they watch, and the range reads and grades use the adjusted style. It can be switched off.
- **Stack depths.** Play at 40bb, 100bb or 200bb. The 100bb charts are adjusted for each depth: at 40bb speculative hands fold more, strong hands get in sooner and every 4-bet is all-in; at 200bb small pairs and suited connectors call more for their implied odds and fewer hands 4-bet or call a 4-bet. Postflop, the stack-to-pot ratio and later-street value follow the real stacks.
- **Rake.** An optional rake of 5% capped at 3bb comes out of every pot that sees a flop. Results are after rake, and the postflop best play counts what you keep, so thin calls and thin value bets are worth less.
- **Multiway pots**, with one read per opponent and a note on how their actions interact.
- **Session tracking.** Running profit and loss in dollars and big blinds, every hand with its main lesson, and leak tags that are marked fixed once you play the same kind of spot correctly. Sessions are saved in the browser.
- **Progress charts.** The Session tab charts your mistake rate over the latest 50 graded decisions across every saved session, the EV you gave up after the flop per 100 hands in each session, and how often each of your most frequent leaks showed up in each session, with the same numbers in a table.
- **Range quizzes.** The Quizzes tab deals a 6-max preflop line (an opponent opens, calls your open or 3-bets it), you paint their range on the 13x13 grid, then estimate your equity against it on a random flop. The painting is scored by how many combos it shares with the range the trainer's opponents play, next to the best score any painting could reach, and the equity guess against an exact enumeration. Your averages over the latest 20 quizzes show whether you paint ranges too wide or too tight and guess equity high or low.
- **Hand replay.** Any hand in the Session tab can be replayed action by action with every opponent's cards shown. Each of your graded decisions is marked with its verdict and opens with the opponents' ranges as they stood at that point.
- **Import your own hands.** Paste hand histories from PokerStars or GGPoker (or open a saved .txt file) on the Import tab. Each no-limit hold'em cash hand with 3 to 9 players is rebuilt and every decision you made is graded with the same charts and postflop model as the Play tab. Save them as a session to get the Session tab's leaks and a replay of each hand; their leaks then steer leak-targeted practice. A Try sample hands button shows how it works.
- **Leak-targeted practice.** New hands lean toward the spots where your open leaks show up. For postflop leaks (a missed value bet, overfolding, a donk bet and so on) the trainer plays your earlier decisions for you and deals the hand straight to a decision where that leak can happen.
- **Install as an app.** Opened from a web address, the trainer can be installed to a phone's home screen or a computer's dock, opens in its own window and works without a connection. See [Install as an app](#install-as-an-app).
- **Optional coaching voice from Claude.** Off by default. With your own Claude API key, each graded decision also gets a short explanation written by Claude from the trainer's computed facts. See [Coach voice](#coach-voice).

## Practice levels

| Level | Focus |
|---|---|
| 1 | Preflop only: opening, defending, 3-bets and 4-bets |
| 2 | Preflop and the flop; the turn and river are checked down |
| 3 | Full hands, heads-up after preflop |
| 4 | 3-bet and 4-bet pots |
| 5 | Multiway pots: an open with two callers, or a squeeze spot |
| 6 | Thin value and bluff-catching: earlier streets play themselves, and you decide on the river with a medium-strength hand |

The Play screen also sets the table size (6-max, or 7, 8 or 9 handed) and the stakes ($0.25/$0.50 or $0.50/$1). Results are tracked in big blinds as well as dollars, so sessions at different stakes compare directly.

After 20 decisions at a level with at least 70% non-mistakes, the Play screen offers the next level.

The **Postflop spots** tab holds twelve hand-built practice spots, one for each common postflop decision (c-betting, bluff-catching, pricing draws, facing raises, thin value and giving up on a missed draw), and the **Engine lab** tab exposes the evaluator, range parser and equity calculator directly.

## Getting started

Requires Node.js 22 or later.

```sh
npm install
npm run dev        # start the app at http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm test` | Engine unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run check` | Typecheck, then unit tests |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run smoke` | Build, then play hands on every level in a headless browser at phone and desktop widths. Needs a Playwright Chromium (`npx playwright install chromium`) |
| `npm run gen:hand-rank` | Regenerate `data/hand-rank.json` |
| `node scripts/icons.mjs` | Render `public/icon.svg` to the PNG app icons |

Continuous integration runs the typecheck, unit tests and smoke test on every pull request.

## Install as an app

The production build is a progressive web app: `public/manifest.webmanifest` names the app and its icons, and `sw.js`, written at build time by `scripts/sw-plugin.ts`, caches every file of the build on the first visit so the app opens and plays offline. Each build gets a new cache, and the app picks up a new build the next time it is opened online. The Claude coach voice still needs a connection.

Browsers only install an app served over HTTPS (or from `localhost`), so it has to be opened from a web address:

- **GitHub Pages.** The app is published at <https://shawnr2424.github.io/poker-coach/>. `.github/workflows/pages.yml` builds and publishes it on every push to main while Pages is switched on (Settings > Pages > Source: GitHub Actions), and is skipped when it is off.
- **Any static host.** Upload the contents of `dist/` after `npm run build`.
- **Locally.** `npm run build && npm run preview` serves the build on `localhost`, which browsers also let you install.

Then use the browser's install option: the install icon in Chrome's or Edge's address bar, or Share > Add to Home Screen in Safari on an iPhone or iPad. The Settings tab shows the install button when the browser offers one, and whether the app is saved for offline use. Hands, sessions and settings live in that browser's storage, so an installed app and the same address in a browser tab share them.

## Coach voice

The **Settings** tab can switch on explanations written by Claude Opus 5.5 through the Claude API. It is off by default, and the trainer works fully without it: every number, verdict and explanation on the feedback panel is computed by the trainer either way.

- **Your key, your browser.** Paste your own API key from the Claude Console. It is stored in this browser's local storage and sent only to `api.anthropic.com`, directly from the page. Requests are billed to your account.
- **Only computed facts are sent.** The request carries the spot, your cards, your action, the verdict, the trainer's reasons, the EV table and the key concept. Opponents' cards are never sent. The fixed instructions are shown under Settings.
- **No invented numbers.** Claude is told to use only the numbers it is given. A reply containing any number that is not in the facts is not shown.
- **Network access.** The page must be able to reach `api.anthropic.com`. Run the app locally (`npm run dev`) or host it somewhere that allows that; embedded previews with a strict content policy will show a "could not reach" note instead.

`src/engine/coach/explain.ts` builds the facts and checks replies, and its tests check the prompt against real decisions from every level.

## Editing the strategy data

All strategy numbers are plain JSON, so you can adjust them without touching code:

| File | Contents |
|---|---|
| `data/preflop/rfi.json`, `vs-open.json`, `vs-3bet.json`, `vs-4bet.json`, `other.json` | Preflop charts: raise and call frequencies per hand, plus sizes. Rows are keyed by 6-max seat; the `EP` rows cover the extra early seats at 7-9 handed |
| `data/preflop/depth.json` | 40bb and 200bb adjustments layered on the 100bb charts, and the raise sizes at each depth |
| `data/preflop/lowstakes.json` | Low-stakes adjustments layered on the charts (fewer 4-bet bluffs, more calling) |
| `data/postflop/actions.json` | Postflop behavior by hand class: betting, calling and raising shares, the range-wide defense floor, and equity realization |
| `data/postflop/profiles.json` | How each opponent style scales that behavior |
| `data/postflop/adapt.json` | When opponents adjust to the hero's tendencies, and by how much |

The unit tests check that every chart parses and round-trips through range notation. Close postflop spots can change verdict when `actions.json` is tuned, so run `npm test` after editing it: each practice spot states which answer its lesson teaches, and a test fails if the model stops agreeing.

## Project layout

```
src/engine/              Framework-free poker logic; all amounts are integer chips (cents)
  cards.ts, evaluator.ts   Cards and the 5-7 card hand evaluator
  hand.ts                  Hand state machine: blinds, legal actions, streets, side pots, showdown, rake
  range.ts, equity.ts      Range notation, card removal, exact and Monte Carlo equity
  math.ts, sizing.ts       Pot odds, break-even fold %, bet EV, SPR, preset sizes
  preflop/                 Charts, spot detection, scenarios, range narrowing, grading
  postflop/                Hand classes, opponent model, narrowing, bots, EV, multiway, combo table
  game/levels.ts           Practice levels, hand generation, leak-targeted spot mix, hand flow
  game/drills.ts           Practice hands that reach the spot of a postflop leak
  session/session.ts       Session totals, leak tracking, curriculum progress, saved data
  session/progress.ts      Mistake-rate trend, EV given up per session and leaks by session, across saved sessions
  session/replay.ts        Compact hand records and the replay that rebuilds each hand from them
  session/adapt.ts         The hero's postflop tendencies and how opponents adjust to them
  session/import.ts        Reads pasted hand histories, rebuilds each hand and grades the hero's decisions
  quiz/quiz.ts             Range quizzes: dealing a line, scoring a painted range and an equity guess, quiz history
  coach/explain.ts         Facts and reply checks for the optional Claude coach voice
src/workers/             Equity Web Worker and its client
src/ui/                  React UI: table/, play/, spots/, quiz/, session/, coach/ (settings and the Claude client), app/ (installing and offline use), and the engine lab
data/                    Editable strategy data (see above)
public/                  App manifest and icons, copied into the build as is
scripts/                 Data generation, the service worker build plugin, icon rendering and the browser smoke test
docs/                    Model notes and spec coverage
```

## What the tests guarantee

- The evaluator agrees with an independent brute-force evaluator on 20,000 random hand pairs.
- Chips balance on every step of 3,000 randomly played hands, and at the end of every practice hand on every level.
- Every range round-trips through text, combos and back, so the grid cannot drift from the range text, and combo counts exclude the hero's cards and the board.
- Break-even fold % gives exactly zero bet EV, and calling at the pot-odds price gives exactly zero call EV.
- Multiway equity matches an exact enumeration of every hand and runout to within 1%, and the combo table matches the grid class by class.
- An opponent's actual hand is always inside the range the trainer shows for them.
- Every hero turn on every level, under random play including custom bet sizes, can be read and graded, or ends the hand cleanly, at 6-max and at 7, 8 and 9 handed.
- After the flop, the split of the hero's range across the available actions always accounts for the whole range, and the line read agrees with what the hero did. If the hero took a line the charts never take, the read says there is no range rather than showing one.
- The approximate range text after the flop is valid notation for exactly the hands it names, names nothing the grid leaves empty, and leaves out only hands the grid holds at low weight. This is checked on every practice spot and on real decisions at every postflop level.
- A practice hand for a postflop leak stops at a decision where that leak's tag is one a wrong action would earn, and plays on normally from there. The hand-flow test also runs every level with every leak open.
- A saved hand replays to exactly the actions, board, stacks and result that were played, at every level and table size, and the hero's decisions fall on the replay's steps. The smoke test opens the replay of every hand in the session.
- Adapted opponents still hold their real hand inside the range the trainer shows, and hands play through at every level. When opponents bluff more, folding to a bet grades best less often; when they bluff less, more often; and betting grades best more often against opponents who give the hero's bets credit than against ones who call them lighter.
- A range facing a bet or a raise defends exactly to the floor when its hand classes alone would fold more, and air keeps folding. In a fixed sample of level 3 hands, raising grades best less than 48% of the time facing a bet, checking more than a sixth of the time with no bet to face, and opponents fold to a 2.5x raise well below what a pure bluff needs.
- An imported hand rebuilds exactly: every action follows the betting order, the stacks, cards and board match the history, and the result is what the history says the hero collected. A hand the trainer plays, written out as a PokerStars hand history, imports back to the same actions and result; this is checked on seeded hands from levels 3 to 5. Hands the trainer cannot model (tournaments, heads-up, antes, straddles, run-it-twice, other games) are skipped with the reason. The smoke test imports the sample hands, saves them and opens each replay.
- With the rake on, stacks plus rake add up to the starting chips over hundreds of random hands, nothing is raked before the flop or from an uncalled excess, and a raked hand replays to the same result. The rake never makes an option's EV higher, leaves folding at zero and never costs more than the cap, heads-up and multiway.
- The production build passes Chromium's installability check (manifest, icons, service worker), and with the network off it still opens and plays a hand. The smoke test checks this.
- Every practice spot grades the way its lesson says: the model's best action is one the lesson recommends, and the actions the lesson warns against are graded mistakes.
- The progress numbers are checked on hand-built sessions: sessions come in the order played, the rolling mistake rate follows its window across sessions, EV given up per 100 hands counts only hands that recorded it, and each leak's rate per session matches its count. The smoke test checks the charts after the hands it plays, including the hover tooltip.
- Range quizzes deal the player's hand from their own chart for the line and score the painting against exactly the chart the trainer's opponents play. The best possible painting is found exactly and no other painting beats it; random and one-hand-off paintings are checked against it on every kind of line. The smoke test paints by dragging and by keyboard, checks both results and that the score survives a reload.
- Session profit and loss equals the sum of hand results, and leaks are marked fixed and reopened as described above.
- The coach voice prompt contains only numbers the feedback panel shows and never an opponent's hidden cards, and a reply with an invented or rounded number is rejected. The smoke test checks that no request is made while the coach voice is off.

## Spec coverage

[docs/spec-coverage.md](docs/spec-coverage.md) maps each part of the original brief to the code that implements it and the tests that check it.

## History

Development went through eight milestones and later additions, each merged as its own pull request. See [CHANGELOG.md](CHANGELOG.md).
