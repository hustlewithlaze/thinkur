// End-to-end + responsive checks against the production build.
// Usage: npm run build && npm run test:e2e   (starts server/server.mjs on a free port)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4321;
const BASE = `http://localhost:${PORT}`;
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

const env = { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '' };
const server = spawn('node', ['server/server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('running') && res()));

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const launch = { executablePath: process.env.CHROMIUM_PATH || undefined };
let browser;
try {
  browser = await chromium.launch(launch);
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && errors.push(m.text()));

await page.goto(`${BASE}/#/overview`);

await check('Overview metrics computed from data', async () => {
  const text = await page.locator('main').innerText();
  for (const s of ['Total tickets', '100', 'Open & pending', '12', '7 open · 5 pending', '38', 'of 88 resolved with CSAT', '14.0h', 'median 8.6h'])
    assert(text.includes(s), `missing "${s}"`);
});
await check('Needs Attention lists groups and High Attention tickets with reasons', async () => {
  const text = await page.locator('main').innerText();
  assert(text.includes('Card declines at online and subscription merchants'), 'card group');
  assert(text.includes('Incoming USD funds reported as not visible'), 'wire group');
  assert(/States a payroll deadline/.test(text), 'payroll reason');
  assert(/Mentions unrecognised admin user/.test(text), 'security reason');
});
await page.screenshot({ path: `${SHOTS}/overview-1440.png`, fullPage: true });

await check('Navigation: every section opens', async () => {
  for (const [label, heading] of [
    ['Operations Queue', 'Operations Queue'],
    ['Incident Intelligence', 'Incident Intelligence'],
    ['Data & Settings', 'Data & Settings'],
    ['Overview', 'Overview'],
  ]) {
    await page.locator('aside nav a', { hasText: label }).click();
    await page.getByRole('heading', { level: 1, name: heading }).waitFor({ timeout: 3000 });
  }
});

await check('Queue: search + combined filters + clear', async () => {
  await page.goto(`${BASE}/#/queue`);
  await page.locator('[aria-live=polite]').waitFor();
  const count = async () => Number((await page.locator('[aria-live=polite]').innerText()).match(/Showing (\d+)/)[1]);
  assert((await count()) === 100, 'starts with 100');
  await page.getByLabel('Search tickets').fill('wire');
  await page.getByRole('button', { name: 'Unresolved' }).click();
  const n = await count();
  assert(n === 2, `wire+unresolved expected 2, got ${n}`);
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.locator('label', { hasText: 'Product' }).locator('select').selectOption('Cards');
  assert((await count()) === 0, 'wire+unresolved+Cards should be 0');
  await page.getByText('No tickets match these filters').waitFor();
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  assert((await count()) === 100, 'cleared');
  await page.getByRole('button', { name: /Urgency signals/ }).click();
  const u = await count();
  assert(u > 0 && u < 20, `urgent count ${u}`);
  await page.getByRole('button', { name: 'Clear' }).click();
});

await check('Queue: sorting by resolution time puts missing values last', async () => {
  await page.locator('th button', { hasText: 'Res.' }).click(); // desc
  const first = await page.locator('tbody tr').first().innerText();
  assert(first.includes('67.8h'), `expected longest first, got ${first.slice(0, 60)}`);
  await page.locator('th button', { hasText: 'Res.' }).click(); // asc
  const firstAsc = await page.locator('tbody tr').first().innerText();
  assert(firstAsc.includes('0.5h'), 'shortest first');
  const last = await page.locator('tbody tr').last().innerText();
  assert(last.includes('—'), 'missing last');
});

await check('Ticket detail shows full text, rule breakdown and group link', async () => {
  await page.goto(`${BASE}/#/queue/TKT-2085`);
  const text = await page.locator('main').innerText();
  assert(text.includes('Following up again on the $118k incoming USD wire'), 'body');
  assert(text.includes('Matched: “affecting payroll”'), 'evidence phrase');
  assert(/\+3[\s\S]*\+2[\s\S]*\+1/.test(text), 'points');
  assert(text.includes('High Attention'), 'label');
  await page.getByRole('link', { name: /Incoming USD funds reported as not visible/ }).click();
  await page.getByRole('heading', { level: 2, name: /Incoming USD funds/ }).waitFor();
});
await page.screenshot({ path: `${SHOTS}/incident-1440.png`, fullPage: true });

await check('Brief: evidence links only to member tickets; labelled rule-based', async () => {
  const text = await page.locator('main').innerText();
  assert(text.includes('Rule-based template'), 'source label');
  assert(text.includes('AI not configured on server'), 'AI off state');
  const ids = await page.locator('main a[href^="#/queue/"]').evaluateAll((as) => as.map((a) => decodeURIComponent(a.getAttribute('href').split('/').pop())));
  const members = ['TKT-2071', 'TKT-2072', 'TKT-2073', 'TKT-2085', 'TKT-2074', 'TKT-2075', 'TKT-2076', 'TKT-2077', 'TKT-2078'];
  const stray = [...new Set(ids)].filter((i) => !members.includes(i));
  assert(stray.length === 0, `non-member links: ${stray}`);
});

await check('Review workflow: investigate, note, action, complete, confirm, dismiss, reopen', async () => {
  await page.getByRole('button', { name: 'Start investigation' }).click();
  await page.getByText('Under Investigation').first().waitFor();
  await page.getByLabel('New note').fill('Checked with payments ops; awaiting bank trace.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.getByLabel('New next action').fill('Request receiving-bank trace for listed wires');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Confirm grouping' }).click();
  await page.getByText('Confirmed by Operator').first().waitFor();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Reopen' }).waitFor();
  // dismissed group's tickets lose the similar-reports points
  await page.goto(`${BASE}/#/queue/TKT-2085`);
  const t = await page.locator('main').innerText();
  assert(!t.includes('Similar reports'), 'crossCustomer should be gone after dismissal');
  await page.goBack();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.getByText('Needs Review').first().waitFor();
  const hist = await page.locator('#decision').innerText();
  for (const s of ['Checked with payments ops', 'Action completed', 'to Confirmed by Operator', 'to Dismissed', 'reopened']) assert(hist.includes(s), `history missing ${s}`);
});

await check('State persists across reload (localStorage)', async () => {
  await page.reload();
  await page.locator('#decision').getByText('Checked with payments ops').waitFor({ timeout: 3000 });
});

await check('Copy brief writes Markdown with source IDs to clipboard', async () => {
  await page.getByRole('button', { name: 'Copy brief' }).click();
  await page.getByRole('status').filter({ hasText: 'copied' }).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.startsWith('# Investigation brief — Incoming USD funds'), 'heading');
  assert(clip.includes('[TKT-2085]') && clip.includes('rule-based template'), 'ids + source');
});

await check('Data: invalid upload rejected, valid upload replaces dataset app-wide, reset restores', async () => {
  await page.goto(`${BASE}/#/data`);
  const input = page.locator('#csv-upload');
  await input.setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('ticket_id,status\nA,open') });
  await page.getByText('was not loaded').waitFor();
  await page.getByText('Missing required column(s): created_at, ticket_subject, ticket_body.').first().waitFor();
  const csv = [
    'ticket_id,created_at,customer_name,product,ticket_subject,ticket_body,status,resolution_time_hours,csat_score',
    'N-1,2026-09-01 09:00,Alpha,Cards,Declines,Card declined at AWS this morning,open,,',
    'N-2,2026-09-01 10:00,Beta,Cards,Declines,Our card was declined at AWS today,open,,',
    'N-3,2026-09-01 11:00,Gamma,Cards,Card failing,Card keeps getting declined at AWS,resolved,5,1',
    'N-3,2026-09-01 12:00,Gamma,Cards,dup,dup,resolved,5,1',
    'N-4,not-a-date,Delta,FX,Rate,How do I convert?,resolved,abc,4',
  ].join('\n');
  await input.setInputFiles({ name: 'new.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByText('Loaded new.csv: 4 valid tickets, 1 rejected.').waitFor();
  const text = await page.locator('main').innerText();
  assert(text.includes('Duplicate ticket_id'), 'dup warning');
  assert(text.includes('Unparseable created_at'), 'date warning');
  assert(text.includes('Non-numeric resolution_time_hours'), 'number warning');
  await page.goto(`${BASE}/#/overview`);
  const ov = await page.locator('main').innerText();
  assert(ov.includes('new.csv') && /Total tickets\s*\n?\s*4/.test(ov), 'overview updated');
  await page.goto(`${BASE}/#/incidents`);
  await page.getByText('Card declines at online and subscription merchants').first().waitFor();
  await page.goto(`${BASE}/#/data`);
  await page.getByRole('button', { name: 'Reset demo data' }).click();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await page.getByText('bizops_challenge_support_tickets.csv').first().waitFor();
});

await check('Settings: reprocess changes groups; defaults restore', async () => {
  const minCust = page.locator('label', { hasText: 'Grouping: minimum distinct customers' }).locator('input');
  await minCust.fill('11');
  await page.getByRole('button', { name: 'Apply & reprocess' }).click();
  await page.getByText(/Now 1 group\./).waitFor();
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await page.getByText(/Now 3 groups\./).waitFor();
});

await check('No uncaught page errors', async () => assert(errors.length === 0, errors.join(' | ')));

// Responsive checks
const viewports = [
  ['desktop-1280', 1280, 800],
  ['desktop-1440', 1440, 900],
  ['tablet-768', 768, 1024],
  ['mobile-390', 390, 844],
  ['mobile-320', 320, 640],
];
const routes = ['#/overview', '#/queue', '#/queue/TKT-2063', '#/incidents', '#/incidents/grp-TKT-2059', '#/data'];
for (const [name, w, h] of viewports) {
  const c = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await c.newPage();
  await check(`No horizontal overflow at ${name}`, async () => {
    const bad = [];
    for (const r of routes) {
      await p.goto(`${BASE}/${r}`);
      await p.waitForTimeout(150);
      const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 0) bad.push(`${r} (+${o}px)`);
    }
    assert(!bad.length, bad.join(', '));
  });
  if (w < 1024) {
    await check(`Mobile menu navigation works at ${name}`, async () => {
      await p.goto(`${BASE}/#/overview`);
      await p.getByRole('button', { name: 'Open menu' }).click();
      await p.locator('#mobile-nav a', { hasText: 'Incident Intelligence' }).click();
      await p.getByRole('heading', { level: 1, name: 'Incident Intelligence' }).waitFor();
      await p.locator('a', { hasText: 'Card declines at online' }).first().click();
      await p.getByRole('button', { name: 'Start investigation' }).waitFor();
      const box = await p.getByRole('button', { name: 'Start investigation' }).boundingBox();
      assert(box.height >= 36, `touch target ${box.height}px`);
      await p.goto(`${BASE}/#/queue`);
      assert(await p.locator('ul li a[href="#/queue/TKT-2063"]').isVisible(), 'ticket cards visible on mobile');
    });
  }
  for (const r of ['#/overview', '#/queue', '#/incidents/grp-TKT-2059']) {
    await p.goto(`${BASE}/${r}`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${SHOTS}/${name}-${r.replace(/[#/]+/g, '_').replace(/^_|_$/g, '')}.png`, fullPage: r === '#/overview' });
  }
  await c.close();
}

await browser.close();
server.kill();

const width = Math.max(...results.map((r) => r[1].length));
for (const [s, n, m] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${n.padEnd(width)} ${m ? `— ${m}` : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
writeFileSync(`${SHOTS}/e2e-results.txt`, results.map((r) => r.join(' | ')).join('\n'));
process.exit(failed ? 1 : 0);
