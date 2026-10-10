// Browser smoke test: builds nothing itself; run `npm run build` first (npm run smoke does).
// Serves dist/ with Vite's preview server, then plays hands on every level at phone and
// desktop widths with random actions, then a few at a 9-handed $0.50/$1 table, at 40bb and
// 200bb stacks, and with the rake on. Fails on a console error, a horizontal scrollbar, or a
// hero turn that never offers a way to act. Checks the Session tab's progress charts, a range quiz, and
// that the app can be installed and opens and plays a hand with the network off. Also checks that the optional Claude coach voice
// makes no request while it is off, and, against a mocked API, that its reply is shown or
// held back when it contains a number the trainer did not compute, and that adaptive opponents
// adjust to a session that folds and bets far more than the best play.
//
//   npm run smoke                 # 8 hands per level
//   HANDS=20 npm run smoke        # more hands per level

import { chromium } from 'playwright';
import { preview } from 'vite';

const HANDS = Number(process.env.HANDS ?? 8);
/** Whether the rake setting is on, and how many finished hands with it on showed rake taken. */
let rakeOn = false;
let rakeSeen = 0;
const LEVELS = [1, 2, 3, 4, 5, 6];
const VIEWPORTS = [
  { width: 380, height: 900, colorScheme: 'light' },
  { width: 1280, height: 900, colorScheme: 'dark' },
];
const TURN_TIMEOUT = 30_000;

const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'silent' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const failures = [];

async function noOverflow(page, where) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  if (scroll > width) failures.push(`${where}: page is ${scroll}px wide in a ${width}px window`);
}

/** Plays one hand with random actions; every hero turn must offer enabled buttons or end the hand. */
async function playHand(page, where) {
  for (let turn = 0; turn < 12; turn++) {
    try {
      await page.waitForFunction(
        () => document.querySelector('.hand-result') || (document.querySelector('.action-bar .act') && !document.querySelector('.action-bar .act').disabled),
        null,
        { timeout: TURN_TIMEOUT },
      );
    } catch {
      const shown = await page.evaluate(() => [...document.querySelectorAll('h2')].map((h) => h.textContent).join(' | '));
      failures.push(`${where}: a hero turn showed no way to act (headings: ${shown || 'none'})`);
      return false;
    }
    if (await page.$('.hand-result')) break;
    // After the flop the read always says what the hero's own line represents.
    if ((await page.$('#pf-rr, #mw-rr')) && !(await page.$('.range-read .hero-read'))) {
      failures.push(`${where}: a postflop read has no "What your line says" section`);
    }
    if (await page.$('#pf-rr, #mw-rr')) {
      const texts = await page.$$eval('.opp', (ops) => ops.map((o) => o.querySelector('.range-text code')?.textContent ?? ''));
      if (!texts.length || texts.some((t) => !t)) failures.push(`${where}: a postflop opponent panel has no range text`);
    }
    const buttons = await page.$$('.action-bar .act:not([type=submit])');
    await buttons[Math.floor(Math.random() * buttons.length)].click();
    await page.waitForFunction(
      () => document.querySelector('.feedback') || document.querySelector('.hand-result') || document.querySelector('.action-bar .act'),
      null,
      { timeout: TURN_TIMEOUT },
    );
    await noOverflow(page, where);
    const next = await page.$('.feedback .primary');
    if (next) await next.click();
  }
  await page.waitForSelector('.hand-result', { timeout: TURN_TIMEOUT });
  await noOverflow(page, where);
  if ((await page.textContent('.hand-result')).includes('in rake')) {
    if (rakeOn) rakeSeen++;
    else failures.push(`${where}: rake was taken with the rake setting off`);
  }
  await page.click('.hand-result .primary');
  return true;
}

/**
 * Range quizzes: a drag across the grid paints a stretch of hands, a key press toggles one, the
 * range check shows the true range beside the painting, the equity check shows the trainer's
 * exact equity, and the score survives a reload.
 */
async function quizCheck(page, tag) {
  await page.goto(`${url}#quiz`);
  await page.waitForSelector('.paint-grid button[data-cls="AA"]');
  const cell = async (cls) => (await page.$(`.paint-grid button[data-cls="${cls}"]`)).boundingBox();
  const from = await cell('AA'), to = await cell('A2s');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  const painted = await page.$$eval('.paint-grid button[aria-pressed="true"]', (b) => b.map((x) => x.dataset.cls));
  if (painted.length !== 13 || !painted.includes('AKs') || !painted.includes('A2s')) failures.push(`${tag}: dragging across the top row painted ${painted.join(' ') || 'nothing'}`);
  await page.focus('.paint-grid button[data-cls="KK"]');
  await page.keyboard.press('Space');
  if ((await page.getAttribute('.paint-grid button[data-cls="KK"]', 'aria-pressed')) !== 'true') failures.push(`${tag}: a key press does not paint a hand`);
  const shown = await page.textContent('#painted-pct');
  if (shown !== `${((6 + 6 + 12 * 4) / 1326 * 100).toFixed(1)}%`) failures.push(`${tag}: painting AA, KK and the suited aces shows ${shown} of hands`);
  await noOverflow(page, `${tag}, quiz`);
  await page.click('#check-range');
  await page.waitForSelector('#range-result');
  if ((await page.$$('.paint-grid.revealed .cell')).length !== 169) failures.push(`${tag}: the range result does not show the whole grid`);
  if (!/matches \d+% of their range/.test(await page.textContent('#range-result'))) failures.push(`${tag}: the range result gives no match`);
  try {
    await page.waitForSelector('#check-equity:not([disabled])', { timeout: 20000 });
  } catch {
    failures.push(`${tag}: the quiz equity was never worked out`);
    return;
  }
  await page.fill('#equity-guess', '40');
  if ((await page.textContent('#guess-out')) !== '40%') failures.push(`${tag}: the equity slider does not show the guess`);
  await page.click('#check-equity');
  const eq = await page.textContent('#equity-result');
  if (!/Your equity is \d+\.\d%; you said 40%/.test(eq)) failures.push(`${tag}: the equity result reads "${eq.slice(0, 120)}"`);
  await noOverflow(page, `${tag}, quiz result`);
  await page.click('#next-quiz');
  await page.reload();
  const summary = await page.$eval('#quiz-summary', (e) => e.textContent).catch(() => '');
  if (!summary.includes('Quizzes1')) failures.push(`${tag}: the quiz score did not survive a reload ("${summary.slice(0, 80)}")`);
  console.log(`${tag}: quiz painted by drag and key, range and equity scored, score kept`);
}

for (const vp of VIEWPORTS) {
  const tag = `${vp.width}px ${vp.colorScheme}`;
  // Service workers are blocked here so API mocking sees every request; the app check below allows them.
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: vp.colorScheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') failures.push(`${tag}: console error: ${m.text()}`); });
  page.on('pageerror', (e) => failures.push(`${tag}: page error: ${e.message}`));

  // The coach voice is off by default: nothing may reach the Claude API until it is switched on.
  let voiceOn = false;
  let reply = () => 'Good decision.';
  const requests = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (!voiceOn) failures.push(`${tag}: the Claude API was called with the coach voice off`);
    const body = JSON.parse(req.postData() ?? '{}');
    requests.push({ body, key: req.headers()['x-api-key'] });
    const facts = JSON.parse(body.messages[0].content.slice(body.messages[0].content.indexOf('{')));
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'msg_smoke', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: reply(facts) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
  });

  await page.goto(`${url}#table`);
  let played = 0;
  for (const level of LEVELS) {
    await page.selectOption('#level', String(level));
    for (let h = 0; h < HANDS; h++) {
      if (!(await playHand(page, `${tag}, level ${level}, hand ${h + 1}`))) break;
      played++;
    }
  }

  // A full-ring table at the higher stakes: 9 seats on screen, every turn still playable.
  await page.selectOption('#table-size', '9');
  await page.selectOption('#stakes', '100');
  for (const level of [1, 3, 5]) {
    await page.selectOption('#level', String(level));
    const seats = await page.$$eval('.seat', (e) => e.length);
    if (seats !== 9) failures.push(`${tag}: 9-handed table shows ${seats} seats`);
    for (let h = 0; h < Math.max(2, HANDS / 2); h++) {
      if (!(await playHand(page, `${tag}, 9-handed, level ${level}, hand ${h + 1}`))) break;
      played++;
    }
  }
  await page.selectOption('#table-size', '6');
  await page.selectOption('#stakes', '50');

  // 40bb and 200bb stacks: seats start with the chosen depth, and every turn is still playable,
  // including 3-bet and 4-bet pots where a 40bb 4-bet is all-in.
  for (const depth of [40, 200]) {
    await page.selectOption('#stacks', String(depth));
    for (const level of [1, 3, 4]) {
      await page.selectOption('#level', String(level));
      const stacks = await page.$$eval('.seat-stack', (e) => e.map((x) => Number(x.textContent.replace(/[^0-9.]/g, ''))));
      if (Math.max(...stacks) !== depth * 0.5) failures.push(`${tag}: at ${depth}bb the largest seat stack is $${Math.max(...stacks)}, not $${depth * 0.5}`);
      for (let h = 0; h < Math.max(2, HANDS / 4); h++) {
        if (!(await playHand(page, `${tag}, ${depth}bb, level ${level}, hand ${h + 1}`))) break;
        played++;
      }
    }
  }
  await page.selectOption('#stacks', '100');

  // Rake on: every turn still playable, and pots that see a flop show the rake taken.
  await page.selectOption('#rake', '5-3');
  rakeOn = true;
  rakeSeen = 0;
  for (const level of [3, 5]) {
    await page.selectOption('#level', String(level));
    for (let h = 0; h < HANDS; h++) {
      if (!(await playHand(page, `${tag}, rake, level ${level}, hand ${h + 1}`))) break;
      played++;
    }
  }
  if (rakeSeen === 0) failures.push(`${tag}: no hand with the rake on showed any rake taken`);
  await page.selectOption('#rake', 'none');
  rakeOn = false;

  // "Practice my leaks" on: the random play above has opened leaks, so some hands are built to
  // reach a postflop leak's spot. Every turn must still be playable.
  await page.check('#focusleaks');
  await page.selectOption('#level', '3');
  let drills = 0;
  for (let h = 0; h < HANDS; h++) {
    const note = await page.$eval('.focus-note', (e) => e.textContent).catch(() => '');
    if (note.includes('played up to a decision')) drills++;
    if (!(await playHand(page, `${tag}, leak practice, hand ${h + 1}`))) break;
    played++;
  }
  await page.uncheck('#focusleaks');

  // Sessions survive a reload and show up on the review screen.
  const before = await page.$eval('.session-link', (e) => e.textContent);
  await page.reload();
  const after = await page.$eval('.session-link', (e) => e.textContent);
  if (before !== after) failures.push(`${tag}: session changed across a reload ("${before}" vs "${after}")`);
  await page.goto(`${url}#session`);
  const rows = await page.$$eval('table.hands tbody tr', (r) => r.length);
  if (rows !== played) failures.push(`${tag}: session shows ${rows} hands, ${played} were played`);
  await noOverflow(page, `${tag}, session`);

  // Progress charts: the mistake-rate line and the per-session table are drawn from the hands
  // just played, the line answers a hover with a tooltip, and the EV chart has a bar for this
  // session, since every postflop decision now records the EV given up.
  if (!(await page.$('#progress-h'))) failures.push(`${tag}: no Progress panel after ${played} hands`);
  else {
    if (!(await page.$('.progress .trend-line'))) failures.push(`${tag}: the mistake-rate chart has no line`);
    const svg = await page.$('.progress svg');
    await svg.scrollIntoViewIfNeeded();
    const chart = await svg.boundingBox();
    await page.mouse.move(chart.x + chart.width * 0.7, chart.y + chart.height / 2);
    if (!(await page.waitForSelector('.progress .chart-tip', { timeout: 2000 }).catch(() => null))) failures.push(`${tag}: hovering the mistake-rate chart shows no tooltip`);
    if (!(await page.$('.progress .ev-bar'))) failures.push(`${tag}: the EV chart has no bar for this session`);
    const tableRows = await page.$$eval('#progress-table tbody tr', (r) => r.length);
    if (tableRows < 1) failures.push(`${tag}: the progress table is empty`);
    await noOverflow(page, `${tag}, progress`);
  }

  await quizCheck(page, tag);
  await page.goto(`${url}#session`);

  // Every saved hand replays from its record; a few are stepped through action by action, and
  // each graded decision opens with its verdict and the opponents' ranges at that point.
  const replays = await page.$$eval('table.hands button[aria-label^="Replay hand"]', (b) => b.map((x) => x.getAttribute('aria-label')));
  if (replays.length !== played) failures.push(`${tag}: ${replays.length} of ${played} hands can be replayed`);
  let stepped = 0;
  for (const [i, label] of replays.entries()) {
    await page.click(`button[aria-label="${label}"]`);
    const where = `${tag}, ${label.toLowerCase()}`;
    if (await page.$('.replay >> text=could not be replayed')) {
      failures.push(`${where}: the saved record did not replay`);
      continue;
    }
    for (const b of await page.$$('.replay-steps button')) {
      await b.click();
      const isEnd = (await b.textContent()) === 'End of hand';
      if (!isEnd && !(await page.$('.replay-decision'))) failures.push(`${where}: a decision shows no verdict`);
    }
    if (!(await page.$('.replay-result'))) failures.push(`${where}: the end of the hand shows no lesson`);
    if (i < 6) {
      await page.click('.replay-nav button:has-text("Start")');
      for (let n = 0; n < 60 && (await page.isEnabled('.replay-nav button:has-text("Next")')); n++) await page.click('.replay-nav button:has-text("Next")');
      if (await page.isEnabled('.replay-nav button:has-text("Next")')) failures.push(`${where}: Next never reached the end`);
      await noOverflow(page, where);
      stepped++;
    }
  }

  // Adaptive opponents: on by default. A session where the hero folds to bets and bets far more
  // often than the best play makes every opponent adjust; the Session tab says so, the Play
  // screen explains it, and postflop opponent panels mark the adjusted style. Switching it off
  // puts the base styles back.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('sessions:v1'));
    const pairs = [...Array(40).fill(['fold', 'call']), ...Array(40).fill(['bet', 'check'])];
    for (const [move, bestMove] of pairs) {
      saved.current.hands.push({
        n: saved.current.hands.length + 1, at: new Date().toISOString(), level: 3, spot: 'Smoke test', hand: 'AhKd', net: 0, bb: 50, decided: true, lesson: '',
        decisions: [{ label: 'Flop', hand: 'AhKd', you: move, verdict: 'mistake', heading: '', tags: [], atRisk: [], move, bestMove }],
      });
    }
    localStorage.setItem('sessions:v1', JSON.stringify(saved));
  });
  await page.goto(`${url}#session`);
  await page.reload();
  const read = await page.$eval('section[aria-labelledby="tendency-h"]', (e) => e.textContent).catch(() => '');
  if (!read.includes('bluffing more') || !read.includes('calling your bets lighter')) failures.push(`${tag}: the Session tab does not say how opponents adjusted ("${read.slice(-160)}")`);
  await noOverflow(page, `${tag}, session tendencies`);
  await page.goto(`${url}#table`);
  if (!(await page.isChecked('#adaptive'))) failures.push(`${tag}: "Opponents adapt to me" is not on by default`);
  await page.selectOption('#level', '3');
  const adaptNote = await page.$eval('.adapt-note', (e) => e.textContent).catch(() => '');
  if (!adaptNote.includes('opponents bluff more')) failures.push(`${tag}: the Play screen does not explain the adjustment ("${adaptNote}")`);
  let markedPanels = 0;
  for (let h = 0; h < 6 && !markedPanels; h++) {
    for (let turn = 0; turn < 12 && !markedPanels; turn++) {
      await page.waitForFunction(() => document.querySelector('.hand-result') || document.querySelector('.action-bar .act:not([disabled])'), null, { timeout: TURN_TIMEOUT });
      if (await page.$('.hand-result')) break;
      if (await page.$('#pf-rr, #mw-rr')) {
        const panels = await page.$$eval('.opp', (ops) => ops.map((o) => !!o.querySelector('.tendency.adjusted')));
        if (panels.some((x) => !x)) failures.push(`${tag}: a postflop opponent panel does not mark the adjusted style`);
        markedPanels = panels.length;
        break;
      }
      const buttons = await page.$$('.action-bar .act:not([type=submit])');
      const call = await page.$('.action-bar .act:has-text("Call"), .action-bar .act:has-text("Check")');
      await (call ?? buttons[0]).click();
      await page.waitForFunction(() => document.querySelector('.feedback') || document.querySelector('.hand-result') || document.querySelector('.action-bar .act'), null, { timeout: TURN_TIMEOUT });
      const next = await page.$('.feedback .primary');
      if (next) await next.click();
    }
    if (!markedPanels) await page.click('button:has-text("New hand")');
  }
  if (!markedPanels) failures.push(`${tag}: no postflop opponent panel came up to check the adjusted style`);
  await page.uncheck('#adaptive');
  if (await page.$('.adapt-note')) failures.push(`${tag}: the adjustment note stays after switching adaptive opponents off`);
  await page.check('#adaptive');

  // Every postflop practice spot renders its read and combo table.
  await page.goto(`${url}#spots`);
  const spots = await page.$$('.spot-pick button');
  for (let i = 0; i < spots.length; i++) {
    await (await page.$$('.spot-pick button'))[i].click();
    await page.waitForSelector('.combo-table', { timeout: TURN_TIMEOUT });
    if (!(await page.$('.range-read .hero-read'))) failures.push(`${tag}, spot ${i + 1}: no "What your line says" section`);
    await noOverflow(page, `${tag}, spot ${i + 1}`);
    // The feedback shows which hands in the hero's range take each action, with the hero's row marked.
    await page.waitForSelector('.action-bar .act:not([disabled])', { timeout: TURN_TIMEOUT });
    await page.click('.action-bar .act');
    await page.waitForSelector('.feedback', { timeout: TURN_TIMEOUT });
    const split = await page.evaluate(() => ({
      rows: document.querySelectorAll('.range-actions li').length,
      you: document.querySelectorAll('.range-actions .you-tag').length,
    }));
    if (split.rows < 2 || split.you !== 1) failures.push(`${tag}, spot ${i + 1}: range-by-action table has ${split.rows} rows and ${split.you} marked as yours`);
    await noOverflow(page, `${tag}, spot ${i + 1} feedback`);
  }

  // Import: the sample hand histories grade, save as a new session, and replay with their verdicts.
  await page.goto(`${url}#import`);
  await page.click('button:has-text("Try sample hands")');
  await page.click('.import-actions .primary:has-text("Grade")');
  await page.waitForSelector('#preview-h', { timeout: TURN_TIMEOUT });
  const previewHead = await page.$eval('#preview-h', (e) => e.textContent);
  if (previewHead !== '3 hands graded, 1 skipped') failures.push(`${tag}: import preview says "${previewHead}"`);
  await noOverflow(page, `${tag}, import preview`);
  await page.click('button:has-text("Save as a new session")');
  await page.goto(`${url}#session`);
  const imported = await page.$$eval('table.hands tbody tr', (r) => r.filter((x) => x.textContent.includes('Imported hand')).length);
  if (imported !== 3) failures.push(`${tag}: the new session shows ${imported} imported hands, expected 3`);
  for (const label of await page.$$eval('table.hands button[aria-label^="Replay hand"]', (b) => b.map((x) => x.getAttribute('aria-label')))) {
    await page.click(`button[aria-label="${label}"]`);
    const where = `${tag}, imported ${label.toLowerCase()}`;
    if (!(await page.$('.replay .eyebrow:has-text("Imported hand")'))) failures.push(`${where}: the replay is not marked as imported`);
    for (const b of await page.$$('.replay-steps button')) {
      await b.click();
      if ((await b.textContent()) !== 'End of hand' && !(await page.$('.replay-decision'))) failures.push(`${where}: a decision shows no verdict`);
    }
    await noOverflow(page, where);
  }

  // Switch the coach voice on with a test key and check both outcomes against the mocked API.
  await page.goto(`${url}#settings`);
  await noOverflow(page, `${tag}, settings`);
  voiceOn = true;
  await page.check('.switch input');
  await page.fill('#api-key', 'sk-ant-smoke-test');
  await page.click('.key-row button[type=submit]');
  const coach = async (expect, label) => {
    await page.goto(`${url}#spots`);
    await (await page.$$('.spot-pick button'))[0].click();
    if (await page.$('.feedback')) await page.click('.feedback button:not(.primary)');
    await page.waitForSelector('.action-bar .act:not([disabled])', { timeout: TURN_TIMEOUT });
    await page.click('.action-bar .act');
    try {
      await page.waitForFunction((t) => document.querySelector('.coach-voice')?.textContent.includes(t), expect, { timeout: TURN_TIMEOUT });
    } catch {
      const got = await page.evaluate(() => document.querySelector('.coach-voice')?.textContent ?? 'no coach panel');
      failures.push(`${tag}: ${label}: expected "${expect}", got "${got}"`);
    }
    await noOverflow(page, `${tag}, ${label}`);
  };
  reply = (facts) => `${facts.heading}. Remember the price you were getting.`;
  await coach('Remember the price you were getting', 'coach reply');
  reply = () => 'They fold 97.3% of the time here.';
  await page.reload();
  await coach('did not compute', 'coach reply with an invented number');
  const sent = requests[0];
  if (!sent) failures.push(`${tag}: the coach voice made no request`);
  else {
    if (sent.key !== 'sk-ant-smoke-test') failures.push(`${tag}: the request did not carry the saved key`);
    if (sent.body.model !== 'claude-opus-5-5') failures.push(`${tag}: the request used model ${sent.body.model}`);
  }

  console.log(`${tag}: ${played} hands across levels ${LEVELS.join(', ')} and 9-handed plus leak practice (${drills} postflop drills), ${rows} in the session (${replays.length} replayed, ${stepped} stepped through), ${spots.length} spots, ${imported} imported hands, ${requests.length} mocked coach requests`);
  await ctx.close();
}

// Installable app: the manifest and icons load, the service worker takes control, and the app
// opens and deals a hand with the network off.
{
  const tag = 'app';
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => failures.push(`${tag}: page error: ${e.message}`));
  await page.goto(`${url}#settings`);
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
    if (!href) return null;
    const m = await (await fetch(href)).json();
    const icons = await Promise.all(m.icons.map(async (i) => ({ ...i, ok: (await fetch(new URL(i.src, new URL(href, location.href)))).ok })));
    return { ...m, icons };
  });
  if (!manifest) failures.push(`${tag}: no manifest link`);
  else {
    if (manifest.display !== 'standalone' || !manifest.start_url || !manifest.name) failures.push(`${tag}: the manifest lacks name, start_url or standalone display`);
    if (!manifest.icons.some((i) => i.sizes === '512x512') || !manifest.icons.some((i) => i.sizes === '192x192')) failures.push(`${tag}: the manifest lacks 192px or 512px icons`);
    for (const i of manifest.icons) if (!i.ok) failures.push(`${tag}: icon ${i.src} does not load`);
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  try {
    await page.waitForSelector('#offline-status', { timeout: 10000 });
  } catch {
    failures.push(`${tag}: the service worker never took control`);
  }
  // Chromium's own installability check: manifest, icons, service worker and secure origin.
  const { installabilityErrors } = await (await ctx.newCDPSession(page)).send('Page.getInstallabilityErrors');
  for (const e of installabilityErrors) failures.push(`${tag}: not installable: ${e.errorId}`);
  await ctx.setOffline(true);
  await page.goto(`${url}#table`);
  await page.reload();
  try {
    await page.waitForSelector('.action-bar .act, .hand-result, .feedback', { timeout: TURN_TIMEOUT });
    if (!(await playHand(page, `${tag}, offline`))) failures.push(`${tag}: no hand could be played offline`);
  } catch {
    failures.push(`${tag}: the app does not open offline`);
  }
  await ctx.setOffline(false);
  console.log(`${tag}: manifest with ${manifest?.icons.length ?? 0} icons, ${installabilityErrors.length} installability errors, service worker in control, a hand played offline`);
  await ctx.close();
}

await browser.close();
await server.close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.map((f) => `- ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('Smoke test passed.');
