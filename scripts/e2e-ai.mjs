// Exercises the AI-configured path end to end against a local fake Anthropic API (no real key or network).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const FAKE_PORT = 4998;
const APP_PORT = 4323;
let mode = 'valid';
let lastRequest = null;

const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastRequest = JSON.parse(body);
    const brief = {
      happening: [
        { text: 'Several customers report incoming USD wires not appearing.', ticketIds: ['TKT-2071', 'TKT-2072'] },
        { text: 'Same pattern seen in TKT-9999.', ticketIds: ['TKT-2071'] }, // fabricated → must be dropped
      ],
      differences: [{ text: 'Two tickets are from the same customer.', ticketIds: ['TKT-2072', 'TKT-2085'] }],
      impact: [{ text: '“affecting payroll”', ticketIds: ['TKT-2085'] }],
      unknowns: ['Whether funds were sent.'],
      questions: ['Do bank records show the wires?'],
      nextStep: 'FAKE-AI next step: ask payments ops to trace the wires.',
    };
    const text = mode === 'valid' ? JSON.stringify(brief) : '{"happening": [oops';
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
}).listen(FAKE_PORT);

const env = { ...process.env, PORT: String(APP_PORT), ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://localhost:${FAKE_PORT}`, THINKUR_AI_MODEL: 'fake-model' };
const server = spawn('node', ['server/server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('running') && r()));

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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:${APP_PORT}/#/incidents/grp-TKT-2071`);

await check('AI status reported as configured (key not exposed)', async () => {
  const s = await page.evaluate(() => fetch('/api/ai/status').then((r) => r.text()));
  assert(s.includes('"configured":true') && !s.includes('test-key'), s);
});
await check('Valid AI response renders, labelled AI-assisted, fabricated citation dropped', async () => {
  await page.getByRole('button', { name: 'Generate AI brief' }).click();
  await page.getByText('AI-assisted', { exact: true }).waitFor();
  const t = await page.locator('main').innerText();
  assert(t.includes('FAKE-AI next step'), 'AI content shown');
  assert(!t.includes('TKT-9999'), 'fabricated ID must not render');
  assert(t.includes('1 unsupported AI statement removed'), 'drop count');
  assert(t.includes('Drafted by fake-model'), 'model label');
});
await check('Only pseudonymised customer labels sent to provider', async () => {
  const content = lastRequest.messages[0].content;
  assert(content.includes('Customer A') && !content.includes('Cobalt Robotics') && !content.includes('NovaFleet'), 'names leaked');
  assert(lastRequest.output_config?.format?.type === 'json_schema', 'structured output requested');
});
await check('Toggle back to rule-based brief', async () => {
  await page.getByRole('button', { name: 'Show rule-based' }).click();
  await page.getByText('Rule-based template').waitFor();
});
await check('Malformed AI output → clear error, rule-based brief kept', async () => {
  mode = 'malformed';
  await page.getByRole('button', { name: 'Refresh AI brief' }).click();
  await page.getByText(/not valid JSON\. Showing the rule-based brief instead\./).waitFor();
});
await check('Provider down → error surfaced, app still usable', async () => {
  fake.close();
  fake.closeAllConnections?.();
  await page.getByRole('button', { name: 'Refresh AI brief' }).click();
  await page.getByText(/AI (request failed|provider error).*Showing the rule-based brief instead\./).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Start investigation' }).click();
  await page.getByText('Under Investigation').first().waitFor();
});

await browser.close();
server.kill();
fake.close();
for (const [s, n, m] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}${m ? ` — ${m}` : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
