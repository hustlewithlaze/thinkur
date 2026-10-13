import { CONCEPTS, conceptsIn, hasSymptom, impactMatches, ticketText, tokenize } from './text';
import type { CandidateGroup, Settings, Ticket } from './types';

type Vec = Map<string, number>;

const DAY = 86_400_000;
const CONCEPT_WEIGHT = 1.5;

function buildVectors(tickets: Ticket[]): Map<string, Vec> {
  const docs = tickets.map((t) => {
    const text = ticketText(t);
    const feats = tokenize(text);
    for (const c of conceptsIn(text)) feats.push(`c:${c}`);
    return { id: t.id, feats };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const f of new Set(d.feats)) df.set(f, (df.get(f) ?? 0) + 1);
  const N = docs.length;
  const out = new Map<string, Vec>();
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const f of d.feats) tf.set(f, (tf.get(f) ?? 0) + 1);
    const v: Vec = new Map();
    let norm = 0;
    for (const [f, n] of tf) {
      const w = n * (Math.log((N + 1) / ((df.get(f) ?? 0) + 1)) + 1) * (f.startsWith('c:') ? CONCEPT_WEIGHT : 1);
      v.set(f, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [f, w] of v) v.set(f, w / norm);
    out.set(d.id, v);
  }
  return out;
}

export function cosine(a: Vec, b: Vec): number {
  let s = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [f, w] of small) {
    const o = large.get(f);
    if (o) s += w * o;
  }
  return s;
}

export interface GroupingResult {
  groups: CandidateGroup[];
  eligibleCount: number; // tickets that describe a problem and have a valid date
  excludedInformational: number; // how-to / informational requests, not used for incident grouping
  excludedUndated: number;
}

/** Ticket IDs that share a body/subject verbatim with others are usually templated FAQs; we don't need them here. */
export function findCandidateGroups(all: Ticket[], settings: Settings): GroupingResult {
  const g = settings.grouping;
  const dated = all.filter((t) => t.createdAt);
  const eligible = dated.filter((t) => hasSymptom(ticketText(t)));
  const vecs = buildVectors(all);

  // Single-linkage over edges that pass text, product and time gates.
  const parent = new Map(eligible.map((t) => [t.id, t.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const sims = new Map<string, number>();
  for (let i = 0; i < eligible.length; i++)
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if ((a.product ?? '') !== (b.product ?? '')) continue;
      if (Math.abs(a.createdAt!.getTime() - b.createdAt!.getTime()) > g.windowDays * DAY) continue;
      const s = cosine(vecs.get(a.id)!, vecs.get(b.id)!);
      sims.set(`${a.id}|${b.id}`, s);
      if (s >= g.similarityThreshold) parent.set(find(a.id), find(b.id));
    }

  const comps = new Map<string, Ticket[]>();
  for (const t of eligible) {
    const r = find(t.id);
    comps.set(r, [...(comps.get(r) ?? []), t]);
  }

  const groups: CandidateGroup[] = [];
  for (const members of comps.values()) {
    if (members.length < g.minTickets) continue;
    const customers = members.map((t) => t.customerName).filter((c): c is string => !!c);
    const identifiable = customers.length === members.length;
    const distinct = identifiable ? new Set(customers).size : null;
    if (distinct !== null && distinct < g.minCustomers) continue;
    members.sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime() || a.id.localeCompare(b.id));
    groups.push(describeGroup(members, distinct, vecs, sims));
  }
  groups.sort((a, b) => b.unresolvedCount - a.unresolvedCount || b.ticketIds.length - a.ticketIds.length);

  return {
    groups,
    eligibleCount: eligible.length,
    excludedInformational: dated.length - eligible.length,
    excludedUndated: all.length - dated.length,
  };
}

const TITLE_RULES: { all: string[]; title: (usd: boolean) => string }[] = [
  { all: ['card_failure', 'online_merchant'], title: () => 'Card declines at online and subscription merchants' },
  { all: ['incoming_funds', 'funds_not_visible'], title: (usd) => `Incoming ${usd ? 'USD ' : ''}funds reported as not visible` },
  { all: ['fx_rate', 'pricing_dissatisfaction'], title: () => 'Customers questioning exchange rates and FX pricing' },
  { all: ['fx_rate'], title: () => 'Exchange-rate and FX pricing questions' },
];

function describeGroup(members: Ticket[], distinct: number | null, vecs: Map<string, Vec>, sims: Map<string, number>): CandidateGroup {
  const n = members.length;
  const texts = members.map(ticketText);
  const conceptCounts = new Map<string, number>();
  texts.forEach((tx) => conceptsIn(tx).forEach((c) => conceptCounts.set(c, (conceptCounts.get(c) ?? 0) + 1)));
  const majority = [...conceptCounts].filter(([, k]) => k / n >= 0.6).sort((a, b) => b[1] - a[1]).map(([c]) => c);

  // Shared terms: feature present in ≥ 40% of tickets, ranked by coverage
  const termCounts = new Map<string, number>();
  members.forEach((t) => new Set(tokenize(ticketText(t))).forEach((w) => termCounts.set(w, (termCounts.get(w) ?? 0) + 1)));
  const sharedTerms = [...termCounts].filter(([, k]) => k >= 2 && k / n >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);

  const usd = texts.filter((t) => /\busd\b/i.test(t)).length / n >= 0.6;
  const rule = TITLE_RULES.find((r) => r.all.every((c) => majority.includes(c)));
  const labels = majority.map((c) => CONCEPTS.find((x) => x.id === c)!.label);
  const title = rule
    ? rule.title(usd)
    : labels.length
      ? labels[0][0].toUpperCase() + labels[0].slice(1) + (labels[1] ? ` · ${labels[1]}` : '')
      : `Similar reports: ${sharedTerms.slice(0, 3).join(', ')}`;

  const products = [...new Set(members.map((t) => t.product ?? 'Unspecified'))];
  const firstAt = members[0].createdAt;
  const lastAt = members[n - 1].createdAt;
  const unresolvedCount = members.filter((t) => t.statusCategory === 'unresolved').length;
  const impactStatements = members.flatMap((t) => impactMatches(ticketText(t)).map((m) => ({ ticketId: t.id, phrase: m.phrase })));

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = members[i].id;
      const b = members[j].id;
      total += sims.get(`${a}|${b}`) ?? sims.get(`${b}|${a}`) ?? cosine(vecs.get(a)!, vecs.get(b)!);
      pairs++;
    }
  const cohesion = pairs ? total / pairs : 0;

  const spanDays = firstAt && lastAt ? (lastAt.getTime() - firstAt.getTime()) / DAY : 0;
  const custText = distinct === null ? 'customer identity not available' : `${distinct} distinct customer${distinct === 1 ? '' : 's'}`;
  const description =
    `${n} tickets (${custText}) in ${products.join(', ')} between ${fmtDay(firstAt)} and ${fmtDay(lastAt)} describe ` +
    `${labels.length ? labels.join(' and ') : 'similar wording'}. ${unresolvedCount} remain open or pending.`;

  const why = [
    ...majority.map((c) => `${conceptCounts.get(c)}/${n} tickets mention ${CONCEPTS.find((x) => x.id === c)!.label}`),
    `${custText} within ${spanDays < 1 ? 'less than a day' : `${spanDays.toFixed(1)} days`}`,
    `All tickets are in the same product (${products.join(', ')})`,
    `Mean pairwise text similarity ${cohesion.toFixed(2)} (0–1, word and concept overlap)`,
  ];
  if (unresolvedCount) why.push(`${unresolvedCount} ticket${unresolvedCount === 1 ? '' : 's'} still open or pending`);
  if (impactStatements.length) why.push(`${new Set(impactStatements.map((s) => s.ticketId)).size} ticket(s) contain explicit impact statements`);

  return {
    id: `grp-${members[0].id}`,
    ticketIds: members.map((t) => t.id),
    title,
    description,
    concepts: majority,
    sharedTerms,
    product: products,
    distinctCustomers: distinct,
    firstAt,
    lastAt,
    unresolvedCount,
    impactStatements,
    defaultStatus: unresolvedCount > 0 || impactStatements.length > 0 ? 'Needs Review' : 'Candidate',
    why,
    cohesion,
  };
}

export function fmtDay(d: Date | null): string {
  if (!d) return 'unknown date';
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
