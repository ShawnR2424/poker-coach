// Browser smoke test: builds nothing itself; run `npm run build` first (npm run smoke does).
// Serves dist/ with Vite's preview server, then plays hands on every level at phone and
// desktop widths with random actions, then a few at a 9-handed $0.50/$1 table. Fails on a console error, a horizontal scrollbar, or a
// hero turn that never offers a way to act. Also checks that the optional Claude coach voice
// makes no request while it is off, and, against a mocked API, that its reply is shown or
// held back when it contains a number the trainer did not compute.
//
//   npm run smoke                 # 8 hands per level
//   HANDS=20 npm run smoke        # more hands per level

import { chromium } from 'playwright';
import { preview } from 'vite';

const HANDS = Number(process.env.HANDS ?? 8);
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
  await page.click('.hand-result .primary');
  return true;
}

for (const vp of VIEWPORTS) {
  const tag = `${vp.width}px ${vp.colorScheme}`;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: vp.colorScheme });
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

  console.log(`${tag}: ${played} hands across levels ${LEVELS.join(', ')} and 9-handed plus leak practice (${drills} postflop drills), ${rows} in the session, ${spots.length} spots, ${requests.length} mocked coach requests`);
  await ctx.close();
}

await browser.close();
await server.close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.map((f) => `- ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('Smoke test passed.');
