// Server-side AI brief generation. The API key is read here only and never sent to the browser.
// AI is enabled strictly when ANTHROPIC_API_KEY is set; otherwise the UI uses its rule-based brief.
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const TIMEOUT_MS = Number(process.env.THINKUR_AI_TIMEOUT_MS ?? 45_000);
const MAX_TICKETS = 60;
const MAX_FIELD = 2_000;

export function aiStatus(env = process.env) {
  const configured = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim() !== '';
  return { configured, model: configured ? env.THINKUR_AI_MODEL || DEFAULT_MODEL : null, provider: configured ? 'Anthropic' : null };
}

const evidenceArray = {
  type: 'array',
  items: {
    type: 'object',
    properties: { text: { type: 'string' }, ticketIds: { type: 'array', items: { type: 'string' } } },
    required: ['text', 'ticketIds'],
    additionalProperties: false,
  },
};
export const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    happening: evidenceArray,
    differences: evidenceArray,
    impact: evidenceArray,
    unknowns: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
    nextStep: { type: 'string' },
  },
  required: ['happening', 'differences', 'impact', 'unknowns', 'questions', 'nextStep'],
  additionalProperties: false,
};

const SYSTEM = `You help a fintech operations team investigate a candidate group of customer-support tickets that a rules engine flagged as possibly related.
Ground every statement in the tickets provided. Rules:
- Cite the supporting ticket IDs in ticketIds for every item in happening, differences and impact. Use only IDs from the input.
- Similar wording is not proof of a shared cause. Describe patterns in customer reports; never state a confirmed root cause.
- Do not infer that a payment, wire or card transaction actually failed, settled or was received; tickets are customer descriptions only.
- Impact: include only impacts a customer explicitly states (quote the phrase). Do not estimate money at risk or sum stated amounts.
- Differences: note tickets that weaken the grouping, repeated contacts from one customer, and details that suggest separate issues.
- Unknowns: facts the tickets cannot establish. Questions: concrete checks for the operations team.
- nextStep: one cautious, low-risk investigative action for a human. Never recommend freezing accounts, changing permissions, moving money, closing tickets or contacting customers automatically.
Be concise: at most 5 items per list, one or two sentences each.`;

/** Validates and sanitises incoming request payload from the browser. */
export function sanitizePayload(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.tickets)) throw new HttpError(400, 'Expected { tickets: [...] }');
  if (body.tickets.length === 0 || body.tickets.length > MAX_TICKETS) throw new HttpError(400, `Between 1 and ${MAX_TICKETS} tickets required`);
  const clip = (v) => String(v ?? '').slice(0, MAX_FIELD);
  return {
    title: clip(body.title),
    tickets: body.tickets.map((t) => ({
      id: clip(t.id),
      created: clip(t.created),
      product: clip(t.product),
      status: clip(t.status),
      customer: clip(t.customer), // pseudonymous label such as "Customer A"
      subject: clip(t.subject),
      body: clip(t.body),
    })),
  };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Validates model output against the schema and the allowed ticket IDs.
 * Items citing unknown IDs or no IDs are dropped (and counted), never shown.
 */
export function validateBrief(raw, allowedIds) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new HttpError(502, 'AI response was not valid JSON');
    }
  }
  if (!obj || typeof obj !== 'object') throw new HttpError(502, 'AI response was not an object');
  const allowed = new Set(allowedIds);
  let dropped = 0;
  const evid = (key) => {
    if (!Array.isArray(obj[key])) throw new HttpError(502, `AI response missing "${key}" list`);
    return obj[key].flatMap((it) => {
      if (!it || typeof it.text !== 'string' || !Array.isArray(it.ticketIds)) {
        dropped++;
        return [];
      }
      const ids = it.ticketIds.filter((x) => typeof x === 'string');
      if (!ids.length || ids.some((id) => !allowed.has(id))) {
        dropped++;
        return [];
      }
      // Any ticket-like ID mentioned in the text must also be in the group
      const mentioned = it.text.match(/\b[A-Z]{2,}-\d+\b/g) ?? [];
      if (mentioned.some((id) => !allowed.has(id))) {
        dropped++;
        return [];
      }
      return [{ text: it.text.trim(), ticketIds: [...new Set(ids)] }];
    });
  };
  const strs = (key) => {
    if (!Array.isArray(obj[key])) throw new HttpError(502, `AI response missing "${key}" list`);
    return obj[key].filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
  };
  if (typeof obj.nextStep !== 'string' || !obj.nextStep.trim()) throw new HttpError(502, 'AI response missing nextStep');
  const out = {
    happening: evid('happening'),
    differences: evid('differences'),
    impact: evid('impact'),
    unknowns: strs('unknowns'),
    questions: strs('questions'),
    nextStep: obj.nextStep.trim(),
  };
  if (!out.happening.length) throw new HttpError(502, 'AI response had no grounded summary items');
  return { brief: out, dropped };
}

/**
 * @param {{ title: string, tickets: { id: string }[] }} payload
 * @param {{ client?: any, model?: string, timeoutMs?: number }} [opts]
 */
export async function generateBrief(payload, { client, model, timeoutMs = TIMEOUT_MS } = {}) {
  const status = aiStatus();
  const m = model ?? status.model ?? DEFAULT_MODEL;
  const c = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 1 });
  const ids = payload.tickets.map((t) => t.id);
  const user =
    `Candidate group: ${payload.title}\nTickets (JSON):\n${JSON.stringify(payload.tickets, null, 1)}\n\n` +
    'Return the investigation brief as JSON matching the schema.';

  let response;
  try {
    response = await c.messages.create(
      {
        model: m,
        max_tokens: 8000,
        system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: BRIEF_SCHEMA } },
        messages: [{ role: 'user', content: user }],
      },
      { timeout: timeoutMs },
    );
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new HttpError(504, 'AI request timed out');
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'AI provider rejected the API key');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(503, 'AI provider rate limit reached; try again later');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `AI provider error (${err.status ?? 'unknown'})`);
    throw new HttpError(502, 'AI request failed');
  }
  if (response.stop_reason === 'refusal') throw new HttpError(502, 'AI declined to generate this brief');
  if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'AI response was truncated');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const { brief, dropped } = validateBrief(text, ids);
  return { ...brief, model: response.model ?? m, droppedUnsupported: dropped };
}

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 500_000) reject(new HttpError(413, 'Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

/** Minimal router shared by the Vite dev server and the production server. Returns true if handled. */
/** @param {any} req @param {any} res @param {{ client?: any, model?: string }} [deps] */
export async function handleApi(req, res, deps = {}) {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/api/')) return false;
  const send = (code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  try {
    if (url === '/api/ai/status' && req.method === 'GET') return send(200, aiStatus()), true;
    if (url === '/api/ai/brief' && req.method === 'POST') {
      if (!aiStatus().configured) return send(503, { error: 'AI is not configured on the server (ANTHROPIC_API_KEY unset).' }), true;
      const payload = sanitizePayload(await readJson(req));
      const brief = await generateBrief(payload, deps);
      return send(200, brief), true;
    }
    return send(404, { error: 'Not found' }), true;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (!(err instanceof HttpError)) console.error('[thinkur api]', err);
    return send(status, { error: err instanceof HttpError ? err.message : 'Internal error' }), true;
  }
}
