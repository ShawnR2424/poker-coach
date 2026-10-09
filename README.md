# Poker Coach

Poker Coach is a browser-based trainer for 6-max No-Limit Hold'em at $0.25/$0.50 with 100bb stacks. You play the hero seat one decision at a time. Before each decision it shows what every opponent is likely to hold. After you act, it grades the decision with computed equity, pot odds and expected value, and explains the result.

> **Approximate GTO.** The preflop charts are static approximations and the postflop opponent model is a hand-class heuristic, not solver output. The trainer is built to teach sound reasoning (ranges, card removal, pot odds, sizing), not to reproduce a solver's exact frequencies. See [docs/model.md](docs/model.md) for what is modeled and what is not.

## Features

- **Range read before every decision.** Each opponent gets a 13x13 grid colored by how their hands fare against yours, a hand-class breakdown, and a combo table showing how many combos of each hand remain after card removal and which known cards removed the rest. Hands that drop out with an opponent's latest action are crossed out.
- **Graded decisions.** Preflop decisions are graded against chart frequencies. Postflop decisions are graded by the EV each legal action and size gives up against the best one. Feedback covers equity, pot odds, sizing ("right idea, wrong size"), sunk-cost and results-oriented thinking.
- **Full hands to showdown**, with opponents in four styles (regular, nit, calling station, aggressive) who act from the same model used to read their range.
- **Multiway pots**, with one read per opponent and a note on how their actions interact.
- **Session tracking.** Running profit and loss in dollars and big blinds, every hand with its main lesson, and leak tags that are marked fixed once you play the same kind of spot correctly. Sessions are saved in the browser.
- **Leak-targeted practice.** New hands lean toward the spots where your open leaks show up.

## Practice levels

| Level | Focus |
|---|---|
| 1 | Preflop only: opening, defending, 3-bets and 4-bets |
| 2 | Preflop and the flop; the turn and river are checked down |
| 3 | Full hands, heads-up after preflop |
| 4 | 3-bet and 4-bet pots |
| 5 | Multiway pots: an open with two callers, or a squeeze spot |
| 6 | Thin value and bluff-catching: earlier streets play themselves, and you decide on the river with a medium-strength hand |

After 20 decisions at a level with at least 70% non-mistakes, the Play screen offers the next level.

The **Postflop spots** tab holds four hand-built practice spots, and the **Engine lab** tab exposes the evaluator, range parser and equity calculator directly.

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

Continuous integration runs the typecheck, unit tests and smoke test on every pull request.

## Editing the strategy data

All strategy numbers are plain JSON, so you can adjust them without touching code:

| File | Contents |
|---|---|
| `data/preflop/rfi.json`, `vs-open.json`, `vs-3bet.json`, `vs-4bet.json`, `other.json` | Preflop charts: raise and call frequencies per hand, plus sizes |
| `data/preflop/lowstakes.json` | Low-stakes adjustments layered on the charts (fewer 4-bet bluffs, more calling) |
| `data/postflop/actions.json` | Postflop behavior by hand class: betting, calling and raising shares, and equity realization |
| `data/postflop/profiles.json` | How each opponent style scales that behavior |

The unit tests check that every chart parses and round-trips through range notation. Close postflop spots can change verdict when `actions.json` is tuned, so run `npm test` after editing it.

## Project layout

```
src/engine/              Framework-free poker logic; all amounts are integer chips (cents)
  cards.ts, evaluator.ts   Cards and the 5-7 card hand evaluator
  hand.ts                  Hand state machine: blinds, legal actions, streets, side pots, showdown
  range.ts, equity.ts      Range notation, card removal, exact and Monte Carlo equity
  math.ts, sizing.ts       Pot odds, break-even fold %, bet EV, SPR, preset sizes
  preflop/                 Charts, spot detection, scenarios, range narrowing, grading
  postflop/                Hand classes, opponent model, narrowing, bots, EV, multiway, combo table
  game/levels.ts           Practice levels, hand generation, leak-targeted spot mix, hand flow
  session/session.ts       Session totals, leak tracking, curriculum progress, saved data
src/workers/             Equity Web Worker and its client
src/ui/                  React UI: table/, play/, spots/, session/, and the engine lab
data/                    Editable strategy data (see above)
scripts/                 Data generation and the browser smoke test
docs/                    Model notes
```

## What the tests guarantee

- The evaluator agrees with an independent brute-force evaluator on 20,000 random hand pairs.
- Chips balance on every step of 3,000 randomly played hands, and at the end of every practice hand on every level.
- Every range round-trips through text, combos and back, so the grid cannot drift from the range text, and combo counts exclude the hero's cards and the board.
- Break-even fold % gives exactly zero bet EV, and calling at the pot-odds price gives exactly zero call EV.
- Multiway equity matches an exact enumeration of every hand and runout to within 1%, and the combo table matches the grid class by class.
- An opponent's actual hand is always inside the range the trainer shows for them.
- Every hero turn on every level, under random play including custom bet sizes, can be read and graded, or ends the hand cleanly.
- Session profit and loss equals the sum of hand results, and leaks are marked fixed and reopened as described above.

## History

Development went through seven milestones, each merged as its own pull request. See [CHANGELOG.md](CHANGELOG.md).
