import { deadlineMatches, securityMatches, ticketText } from './text';
import type { CandidateGroup, PriorityLabel, ReviewStatus, Settings, SignalMatch, Ticket, TicketPriority } from './types';

export const RULES: { id: SignalMatch['ruleId']; label: string; description: string }[] = [
  { id: 'deadlineOrInterruption', label: 'Deadline or interruption', description: 'Ticket text explicitly mentions a payroll or supplier/vendor payment deadline, or states a service interruption.' },
  { id: 'security', label: 'Security concern', description: 'Ticket text explicitly mentions unrecognised users or transactions, retained access, or unauthorised activity.' },
  { id: 'crossCustomer', label: 'Similar reports', description: 'Ticket belongs to a non-dismissed candidate group with reports from at least two distinct customers.' },
  { id: 'unresolved', label: 'Open or pending', description: 'Ticket status is open or pending.' },
  { id: 'lowCsat', label: 'Low CSAT', description: 'Resolved ticket with a CSAT score at or below the configured threshold (missing CSAT never counts).' },
];

export interface PriorityContext {
  groupByTicket: Map<string, CandidateGroup>;
  statusOf: (g: CandidateGroup) => ReviewStatus;
}

export function labelFor(score: number, s: Settings): PriorityLabel {
  if (score >= s.highAttentionMin) return 'High Attention';
  if (score >= s.reviewMin) return 'Review';
  return 'Routine';
}

/** Deterministic, explainable prototype score. Each rule fires at most once per ticket. Revenue and segment are never used. */
export function scoreTicket(t: Ticket, ctx: PriorityContext, s: Settings): TicketPriority {
  const text = ticketText(t);
  const w = s.weights;
  const signals: SignalMatch[] = [];

  const deadline = deadlineMatches(text);
  if (deadline.length && w.deadlineOrInterruption)
    signals.push({
      ruleId: 'deadlineOrInterruption',
      label: 'Deadline or interruption',
      points: w.deadlineOrInterruption,
      reason: `States a ${deadline[0].kind}`,
      evidence: deadline[0].phrase,
    });

  const sec = securityMatches(text);
  if (sec.length && w.security)
    signals.push({ ruleId: 'security', label: 'Security concern', points: w.security, reason: `Mentions ${sec[0].kind}`, evidence: sec[0].phrase });

  const g = ctx.groupByTicket.get(t.id);
  if (g && w.crossCustomer && ctx.statusOf(g) !== 'Dismissed' && (g.distinctCustomers ?? 0) >= 2)
    signals.push({
      ruleId: 'crossCustomer',
      label: 'Similar reports',
      points: w.crossCustomer,
      reason: `Part of "${g.title}" (${g.distinctCustomers} distinct customers)`,
    });

  if (t.statusCategory === 'unresolved' && w.unresolved)
    signals.push({ ruleId: 'unresolved', label: 'Open or pending', points: w.unresolved, reason: `Status is ${t.status}` });

  if (t.statusCategory === 'resolved' && t.csatScore !== null && t.csatScore <= s.lowCsatThreshold && w.lowCsat)
    signals.push({ ruleId: 'lowCsat', label: 'Low CSAT', points: w.lowCsat, reason: `Resolved with CSAT ${t.csatScore} (threshold ≤ ${s.lowCsatThreshold})` });

  const score = signals.reduce((a, x) => a + x.points, 0);
  return { score, label: labelFor(score, s), signals };
}

export function scoreAll(tickets: Ticket[], ctx: PriorityContext, s: Settings): Map<string, TicketPriority> {
  return new Map(tickets.map((t) => [t.id, scoreTicket(t, ctx, s)]));
}
