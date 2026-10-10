// Browser smoke test: builds nothing itself; run `npm run build` first (npm run smoke does).
// Serves dist/ with Vite's preview server, then plays hands on every level at phone and
// desktop widths with random actions. Fails on a console error, a horizontal scrollbar, or a
// hero turn that never offers a way to act.
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

  await page.goto(`${url}#table`);
  let played = 0;
  for (const level of LEVELS) {
    await page.selectOption('#level', String(level));
    for (let h = 0; h < HANDS; h++) {
      if (!(await playHand(page, `${tag}, level ${level}, hand ${h + 1}`))) break;
      played++;
    }
  }

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
    await noOverflow(page, `${tag}, spot ${i + 1}`);
  }

  console.log(`${tag}: ${played} hands across levels ${LEVELS.join(', ')}, ${rows} in the session, ${spots.length} spots`);
  await ctx.close();
}

await browser.close();
await server.close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.map((f) => `- ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('Smoke test passed.');
