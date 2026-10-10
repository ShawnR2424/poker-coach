// Sample hand histories for the Import tab's "Try sample hands" button and the tests: three hands
// the trainer reads (a 6-max PokerStars hand, a four-handed one that goes to showdown, and a
// GGPoker hand) and one heads-up hand it skips. Names and hand numbers are made up.

export const BTN_CBET = `PokerStars Hand #250000000001:  Hold'em No Limit ($0.25/$0.50 USD) - 2024/05/01 20:00:00 ET
Table 'Alpha' 6-max Seat #4 is the button
Seat 1: Anna ($50.00 in chips)
Seat 2: Ben ($48.75 in chips)
Seat 3: Cara ($52.10 in chips)
Seat 4: Hero ($50 in chips)
Seat 5: Dan ($61.40 in chips)
Seat 6: Eve ($50.00 in chips)
Dan: posts small blind $0.25
Eve: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Anna: folds
Ben: folds
Cara: folds
Hero: raises $0.75 to $1.25
Dan: folds
Eve: calls $0.75
*** FLOP *** [Ks 7d 2c]
Eve: checks
Hero: bets $0.85
Eve: folds
Uncalled bet ($0.85) returned to Hero
Hero collected $2.65 from pot
*** SUMMARY ***
Total pot $2.75 | Rake $0.10
Board [Ks 7d 2c]
Seat 4: Hero (button) collected ($2.65)`;

export const FOUR_HANDED_SHOWDOWN = `PokerStars Hand #250000000002:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/05/01 20:05:00 ET
Table 'Beta' 6-max Seat #2 is the button
Seat 1: Hero ($100 in chips)
Seat 2: Finn ($85.50 in chips)
Seat 3: Gus ($120 in chips)
Seat 4: Hal ($100 in chips)
Seat 5: Ivy ($40 in chips) is sitting out
Gus: posts small blind $0.50
Hal: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Qh Qc]
Hero: raises $1.50 to $2.50
Finn: calls $2.50
Gus: folds
Hal: folds
*** FLOP *** [Jd 8s 3h]
Hero: bets $3
Finn: calls $3
*** TURN *** [Jd 8s 3h] [2c]
Hero: bets $7
Finn: calls $7
*** RIVER *** [Jd 8s 3h 2c] [Ts]
Hero: checks
Finn: bets $12
Hero: calls $12
*** SHOW DOWN ***
Finn: shows [Jh Tc] (two pair, Jacks and Tens)
Hero: mucks hand
Finn collected $50.50 from pot
*** SUMMARY ***
Total pot $50.50 | Rake $0
Seat 2: Finn (button) showed [Jh Tc] and won ($50.50) with two pair, Jacks and Tens`;

export const GG_SB_SQUEEZE = `Poker Hand #RC1234567: Hold'em No Limit ($0.05/$0.1) - 2024/05/01 20:00:00
Table 'RushAndCash1' 6-max Seat #1 is the button
Seat 1: 1a2b3c ($10 in chips)
Seat 2: Hero ($10.5 in chips)
Seat 3: 4d5e6f ($9.2 in chips)
Seat 4: 7g8h9i ($12 in chips)
Seat 5: aa11bb ($10 in chips)
Seat 6: cc22dd ($10 in chips)
Hero: posts small blind $0.05
4d5e6f: posts big blind $0.1
*** HOLE CARDS ***
Dealt to 1a2b3c
Dealt to Hero [7c 7d]
Dealt to 4d5e6f
Dealt to 7g8h9i
Dealt to aa11bb
Dealt to cc22dd
7g8h9i: raises $0.15 to $0.25
aa11bb: folds
cc22dd: folds
1a2b3c: folds
Hero: raises $0.75 to $1
4d5e6f: folds
7g8h9i: calls $0.75
*** FLOP *** [Ac 9h 4s]
Hero: bets $0.7
7g8h9i: folds
Uncalled bet ($0.7) returned to Hero
*** SHOWDOWN ***
Hero collected $2.03 from pot
*** SUMMARY ***
Total pot $2.1 | Rake $0.07`;

export const HEADS_UP = `PokerStars Hand #250000000004:  Hold'em No Limit ($0.25/$0.50 USD) - 2024/05/01 20:10:00 ET
Table 'Gamma' 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: Lou ($50 in chips)
Hero: posts small blind $0.25
Lou: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [9s 9h]
Hero: raises $1 to $1.50
Lou: folds
Uncalled bet ($1) returned to Hero
Hero collected $1 from pot`;

export const SAMPLE_HANDS = [BTN_CBET, FOUR_HANDED_SHOWDOWN, GG_SB_SQUEEZE, HEADS_UP].join('\n\n\n');
