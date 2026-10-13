import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRuleBasedBrief, briefToMarkdown } from './brief';
import { parseTicketsCsv } from './csv';
import { EMPTY_FILTERS, filterTickets, sortTickets } from './filter';
import { findCandidateGroups } from './grouping';
import { computeMetrics } from './metrics';
import { scoreAll, scoreTicket, type PriorityContext } from './priority';
import { deadlineMatches, hasSymptom, securityMatches } from './text';
import { DEFAULT_SETTINGS, type CandidateGroup, type Ticket } from './types';

const tickets = parseTicketsCsv(readFileSync('data/support_tickets.csv', 'utf8')).tickets;
const byId = new Map(tickets.map((t) => [t.id, t]));
const grouping = findCandidateGroups(tickets, DEFAULT_SETTINGS);
const groupByTicket = new Map<string, CandidateGroup>();
grouping.groups.forEach((g) => g.ticketIds.forEach((id) => groupByTicket.set(id, g)));
const ctx: PriorityContext = { groupByTicket, statusOf: (g) => g.defaultStatus };

const mk = (o: Partial<Ticket>): Ticket => ({
  id: 'X',
  rowNumber: 2,
  createdAtRaw: '',
  createdAt: new Date(2026, 7, 1),
  customerName: 'A',
  customerSegment: null,
  monthlyRevenueUsd: null,
  country: null,
  product: 'Cards',
  subject: '',
  body: '',
  status: 'resolved',
  statusCategory: 'resolved',
  resolutionTimeHours: null,
  csatScore: null,
  ...o,
});

describe('metrics', () => {
  it('computes dataset metrics with explicit denominators', () => {
    const m = computeMetrics(tickets, 2);
    expect(m.total).toBe(100);
    expect(m.unresolved).toBe(12);
    expect(m.open).toBe(7);
    expect(m.pending).toBe(5);
    expect(m.resolutionSample).toBe(88);
    expect(m.avgResolutionHours).toBeCloseTo(14.009, 2);
    expect(m.medianResolutionHours).toBeCloseTo(8.65, 2);
    expect(m.csatSample).toBe(88);
    expect(m.lowCsat).toBe(38); // 15 × CSAT 1 + 23 × CSAT 2
    expect(m.distinctCustomers).toBe(27);
  });

  it('excludes missing values rather than treating them as zero', () => {
    const m = computeMetrics([mk({ resolutionTimeHours: 10, csatScore: 5 }), mk({ id: 'Y' }), mk({ id: 'Z', status: 'open', statusCategory: 'unresolved', resolutionTimeHours: 99 })], 2);
    expect(m.avgResolutionHours).toBe(10); // missing excluded; unresolved ticket's time excluded
    expect(m.csatSample).toBe(1);
    expect(m.lowCsat).toBe(0);
    expect(m.missingCsatResolved).toBe(1);
  });

  it('handles an empty dataset without dividing by zero', () => {
    const m = computeMetrics([], 2);
    expect(m.avgResolutionHours).toBeNull();
    expect(m.medianResolutionHours).toBeNull();
    expect(m.firstDate).toBeNull();
  });
});

describe('signal extraction', () => {
  it('does not treat how-to questions about supplier payments as deadlines', () => {
    expect(deadlineMatches('Can I schedule a supplier payment for next Friday?')).toHaveLength(0);
    expect(hasSymptom('How do I change the monthly spend limit for one employee card?')).toBe(false);
  });
  it('detects explicit payroll, supplier and interruption statements', () => {
    expect(deadlineMatches('Payroll funding depends on this arriving.')[0].kind).toMatch(/payroll/);
    expect(deadlineMatches('We need them for a supplier payment this afternoon.')).not.toHaveLength(0);
    expect(deadlineMatches('We need this fixed before services are interrupted.')).not.toHaveLength(0);
  });
  it('detects security concerns', () => {
    expect(securityMatches('There is a new admin user on our account named Daniel that nobody here recognizes.')).not.toHaveLength(0);
    expect(securityMatches('How do I give our bookkeeper view-only access?')).toHaveLength(0);
  });
});

describe('candidate grouping on the real dataset', () => {
  const find = (id: string) => grouping.groups.find((g) => g.ticketIds.includes(id));

  it('finds the three multi-customer patterns found in the EDA', () => {
    expect(grouping.groups).toHaveLength(3);
    const cards = find('TKT-2063')!;
    const wires = find('TKT-2072')!;
    const fx = find('TKT-2057')!;
    expect(cards.ticketIds).toHaveLength(14);
    expect(cards.distinctCustomers).toBe(12);
    expect(cards.unresolvedCount).toBe(3);
    expect(wires.ticketIds).toHaveLength(9);
    expect(wires.distinctCustomers).toBe(8);
    expect(wires.unresolvedCount).toBe(5);
    expect(fx.ticketIds).toHaveLength(11);
    expect(new Set([cards.id, wires.id, fx.id]).size).toBe(3);
  });

  it('keeps groups within one product and does not group unrelated security tickets', () => {
    for (const g of grouping.groups) expect(new Set(g.ticketIds.map((id) => byId.get(id)!.product)).size).toBe(1);
    for (const id of ['TKT-2079', 'TKT-2080', 'TKT-2081', 'TKT-2082']) expect(find(id)).toBeUndefined();
  });

  it('excludes informational how-to tickets', () => {
    expect(find('TKT-2001')).toBeUndefined();
    expect(grouping.excludedInformational).toBeGreaterThan(50);
  });

  it('respects min-customer and window settings', () => {
    const strict = findCandidateGroups(tickets, { ...DEFAULT_SETTINGS, grouping: { ...DEFAULT_SETTINGS.grouping, minCustomers: 13 } });
    expect(strict.groups).toHaveLength(0);
    const single = findCandidateGroups(
      [mk({ id: 'a', body: 'Card declined at AWS', statusCategory: 'unresolved' }), mk({ id: 'b', body: 'Card declined at AWS again' }), mk({ id: 'c', body: 'Card declined at AWS still' })],
      DEFAULT_SETTINGS,
    );
    expect(single.groups).toHaveLength(0); // one customer only
  });

  it('does not group on generic words alone', () => {
    const g = findCandidateGroups(
      ['Payment help please', 'Account payment question', 'Help with my account payment'].map((b, i) => mk({ id: `g${i}`, customerName: `C${i}`, body: b })),
      DEFAULT_SETTINGS,
    );
    expect(g.groups).toHaveLength(0);
  });
});

describe('priority rules', () => {
  const scores = scoreAll(tickets, ctx, DEFAULT_SETTINGS);

  it('scores an open wire follow-up with a payroll deadline as High Attention, with each rule once', () => {
    const p = scores.get('TKT-2085')!;
    expect(p.signals.map((s) => s.ruleId).sort()).toEqual(['crossCustomer', 'deadlineOrInterruption', 'unresolved']);
    expect(p.score).toBe(6);
    expect(p.label).toBe('High Attention');
  });

  it('scores the unrecognised admin user as a security concern', () => {
    const p = scores.get('TKT-2079')!;
    expect(p.signals.map((s) => s.ruleId)).toEqual(['security', 'unresolved']);
    expect(p.label).toBe('High Attention');
  });

  it('gives low-CSAT points only to resolved tickets with a recorded score', () => {
    expect(scoreTicket(mk({ csatScore: 2 }), ctx, DEFAULT_SETTINGS).signals.map((s) => s.ruleId)).toEqual(['lowCsat']);
    expect(scoreTicket(mk({ csatScore: null }), ctx, DEFAULT_SETTINGS).score).toBe(0);
    expect(scoreTicket(mk({ csatScore: 3 }), ctx, DEFAULT_SETTINGS).score).toBe(0);
  });

  it('never uses revenue or segment', () => {
    const a = scoreTicket(mk({ monthlyRevenueUsd: 100, customerSegment: 'SMB' }), ctx, DEFAULT_SETTINGS);
    const b = scoreTicket(mk({ monthlyRevenueUsd: 1_000_000, customerSegment: 'Enterprise' }), ctx, DEFAULT_SETTINGS);
    expect(a).toEqual(b);
  });

  it('removes similar-report points when an operator dismisses the group', () => {
    const dismissed = scoreTicket(byId.get('TKT-2085')!, { groupByTicket, statusOf: () => 'Dismissed' }, DEFAULT_SETTINGS);
    expect(dismissed.signals.some((s) => s.ruleId === 'crossCustomer')).toBe(false);
    expect(dismissed.score).toBe(4);
  });

  it('applies configured weights and thresholds', () => {
    const s = { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights, unresolved: 0 }, highAttentionMin: 10, reviewMin: 5 };
    const p = scoreTicket(byId.get('TKT-2085')!, ctx, s);
    expect(p.score).toBe(5);
    expect(p.label).toBe('Review');
  });
});

describe('queue filtering and sorting', () => {
  const fctx = { priorities: scoreAll(tickets, ctx, DEFAULT_SETTINGS), groupByTicket, lowCsatThreshold: 2 };
  it('combines search and filters', () => {
    const r = filterTickets(tickets, { ...EMPTY_FILTERS, q: 'wire', status: 'unresolved', product: 'Payments' }, fctx);
    expect(r.map((t) => t.id).sort()).toEqual(['TKT-2072', 'TKT-2085']);
  });
  it('filters urgency signals and group membership', () => {
    const urgent = filterTickets(tickets, { ...EMPTY_FILTERS, urgentOnly: true }, fctx);
    expect(urgent.every((t) => fctx.priorities.get(t.id)!.signals.some((s) => s.ruleId === 'deadlineOrInterruption' || s.ruleId === 'security'))).toBe(true);
    expect(filterTickets(tickets, { ...EMPTY_FILTERS, group: 'any' }, fctx)).toHaveLength(34);
    expect(filterTickets(tickets, { ...EMPTY_FILTERS, csat: 'missing' }, fctx)).toHaveLength(12);
  });
  it('sorts missing values last in both directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const s = sortTickets(tickets, { key: 'resolution', dir }, fctx.priorities);
      expect(s.slice(-12).every((t) => t.resolutionTimeHours === null)).toBe(true);
    }
    const asc = sortTickets(tickets, { key: 'resolution', dir: 'asc' }, fctx.priorities);
    expect(asc[0].resolutionTimeHours).toBe(0.5);
  });
});

describe('rule-based brief', () => {
  it('cites only member tickets and states only explicit impacts', () => {
    for (const g of grouping.groups) {
      const b = buildRuleBasedBrief(g, byId);
      const members = new Set(g.ticketIds);
      const items = [...b.happening, ...b.evidence, ...b.differences, ...b.impact];
      for (const it of items) {
        expect(it.ticketIds.length).toBeGreaterThan(0);
        for (const id of it.ticketIds) expect(members.has(id)).toBe(true);
      }
      for (const imp of b.impact) {
        const phrase = imp.text.match(/“(.+)”/)![1];
        expect(byId.get(imp.ticketIds[0])!.body + byId.get(imp.ticketIds[0])!.subject).toContain(phrase);
      }
      const md = briefToMarkdown(g, b, 'Needs Review');
      expect(md).not.toMatch(/root cause (is|was)|(?<!not a )confirmed cause|money at risk|exposure of/i);
      expect(b.unknowns.length).toBeGreaterThan(0);
      expect(b.questions.length).toBeGreaterThan(0);
    }
  });

  it('surfaces the repeated-customer and in-person differences for the card group', () => {
    const g = grouping.groups.find((x) => x.ticketIds.includes('TKT-2063'))!;
    const b = buildRuleBasedBrief(g, byId);
    const text = b.differences.map((d) => d.text).join(' ');
    expect(text).toMatch(/same customer/);
    expect(text).toMatch(/in-person/);
  });
});
