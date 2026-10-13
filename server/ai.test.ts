import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiStatus, generateBrief, handleApi, sanitizePayload, validateBrief } from './ai.mjs';

const ids = ['TKT-1', 'TKT-2', 'TKT-3'];
const good = {
  happening: [{ text: 'Three customers report card declines online.', ticketIds: ['TKT-1', 'TKT-2'] }],
  differences: [{ text: 'TKT-3 mentions in-person use works.', ticketIds: ['TKT-3'] }],
  impact: [{ text: '“payroll funding depends on this”', ticketIds: ['TKT-2'] }],
  unknowns: ['Decline codes'],
  questions: ['What do processor logs show?'],
  nextStep: 'Ask card ops to pull decline codes.',
};
const payload = { title: 'g', tickets: ids.map((id) => ({ id, created: '2026-08-01', product: 'Cards', status: 'open', customer: 'Customer A', subject: 's', body: 'b' })) };
const fakeClient = (impl: () => Promise<unknown>) => ({ messages: { create: vi.fn(impl) } }) as unknown as Anthropic;

afterEach(() => vi.unstubAllEnvs());

describe('aiStatus', () => {
  it('is disabled without an API key', () => {
    expect(aiStatus({}).configured).toBe(false);
    expect(aiStatus({ ANTHROPIC_API_KEY: '  ' }).configured).toBe(false);
    expect(aiStatus({ ANTHROPIC_API_KEY: 'k' }).configured).toBe(true);
  });
});

describe('validateBrief', () => {
  it('accepts a valid grounded response', () => {
    const { brief, dropped } = validateBrief(JSON.stringify(good), ids);
    expect(dropped).toBe(0);
    expect(brief.happening).toHaveLength(1);
  });
  it('drops statements that cite unknown or no ticket IDs, including IDs only mentioned in text', () => {
    const bad = {
      ...good,
      happening: [...good.happening, { text: 'Also seen in TKT-999.', ticketIds: ['TKT-1'] }, { text: 'Uncited claim', ticketIds: [] }],
      impact: [{ text: 'Fabricated', ticketIds: ['TKT-404'] }],
    };
    const { brief, dropped } = validateBrief(bad, ids);
    expect(dropped).toBe(3);
    expect(brief.impact).toHaveLength(0);
    expect(brief.happening.map((h: { text: string }) => h.text)).toEqual([good.happening[0].text]);
  });
  it('rejects malformed output', () => {
    expect(() => validateBrief('not json', ids)).toThrow(/valid JSON/);
    expect(() => validateBrief({ ...good, unknowns: 'x' }, ids)).toThrow(/unknowns/);
    expect(() => validateBrief({ ...good, nextStep: '' }, ids)).toThrow(/nextStep/);
    expect(() => validateBrief({ ...good, happening: [{ text: 'x', ticketIds: ['nope'] }] }, ids)).toThrow(/no grounded/);
  });
});

describe('sanitizePayload', () => {
  it('requires tickets and clips fields', () => {
    expect(() => sanitizePayload({})).toThrow();
    expect(() => sanitizePayload({ tickets: [] })).toThrow();
    const p = sanitizePayload({ tickets: [{ id: 'a', body: 'x'.repeat(5000), extra: 'dropped' }] });
    expect(p.tickets[0].body).toHaveLength(2000);
    expect(p.tickets[0]).not.toHaveProperty('extra');
  });
});

describe('generateBrief', () => {
  it('returns a validated brief from a structured response', async () => {
    const client = fakeClient(async () => ({ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(good) }] }));
    const r = await generateBrief(payload, { client, model: 'm' });
    expect(r.model).toBe('m');
    expect(r.droppedUnsupported).toBe(0);
    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.output_config.format.type).toBe('json_schema');
    expect(call.messages[0].content).not.toContain('Cobalt'); // only the pseudonymised payload is sent
  });
  it('maps timeouts, refusals and truncation to errors', async () => {
    await expect(generateBrief(payload, { client: fakeClient(async () => Promise.reject(new Anthropic.APIConnectionTimeoutError())) })).rejects.toMatchObject({ status: 504 });
    await expect(generateBrief(payload, { client: fakeClient(async () => ({ stop_reason: 'refusal', content: [] })) })).rejects.toThrow(/declined/);
    await expect(generateBrief(payload, { client: fakeClient(async () => ({ stop_reason: 'max_tokens', content: [] })) })).rejects.toThrow(/truncated/);
    await expect(generateBrief(payload, { client: fakeClient(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{oops' }] })) })).rejects.toThrow(/JSON/);
  });
});

describe('handleApi', () => {
  const run = async (url: string, method = 'GET') => {
    const res = { statusCode: 0, headers: {} as Record<string, string>, body: '', setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: string) { this.body = b; } };
    const req = { url, method, on: () => req } as never;
    const handled = await handleApi(req, res as never);
    return { handled, status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  it('reports status without exposing the key and refuses briefs when unconfigured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await run('/other')).handled).toBe(false);
    const s = await run('/api/ai/status');
    expect(s.json).toEqual({ configured: false, model: null, provider: null });
    const b = await run('/api/ai/brief', 'POST');
    expect(b.status).toBe(503);
  });
  it('never echoes the key in status', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-secret-value');
    const s = await run('/api/ai/status');
    expect(JSON.stringify(s.json)).not.toContain('sk-secret');
  });
});
