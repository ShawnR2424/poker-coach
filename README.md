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
  coach/explain.ts         Facts and reply checks for the optional Claude coach voice
src/workers/             Equity Web Worker and its client
src/ui/                  React UI: table/, play/, spots/, session/, coach/ (settings and the Claude client), and the engine lab
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
- The coach voice prompt contains only numbers the feedback panel shows and never an opponent's hidden cards, and a reply with an invented or rounded number is rejected. The smoke test checks that no request is made while the coach voice is off.

## History

Development went through eight milestones, each merged as its own pull request. See [CHANGELOG.md](CHANGELOG.md).
