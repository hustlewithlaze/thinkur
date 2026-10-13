import { fmtDay } from './grouping';
import { CONCEPTS, conceptsIn, impactMatches, isFollowUp, merchantsIn, statedAmounts, ticketText } from './text';
import type { Brief, CandidateGroup, EvidenceItem, Ticket } from './types';

interface Playbook {
  unknowns: string[];
  questions: (g: CandidateGroup, ctx: PlaybookCtx) => string[];
  nextStep: (g: CandidateGroup, ctx: PlaybookCtx) => string;
}
interface PlaybookCtx {
  window: string;
  deadlineIds: string[];
  inPersonIds: string[];
}

const PLAYBOOKS: Record<string, Playbook> = {
  card_failure: {
    unknowns: [
      'Decline reason codes, merchant category codes and whether 3-D Secure or fraud rules were involved — none are in the dataset.',
      'Whether the declines originated with Loop, the card issuer/processor, the card network or the merchants.',
    ],
    questions: (g, c) => [
      `Do issuer/processor logs show decline reason codes for these customers' cards during ${c.window}? Is one code dominant?`,
      c.inPersonIds.length
        ? `Are failures limited to card-not-present (online) transactions? ${c.inPersonIds.join(', ')} report in-person use still working.`
        : 'Are failures limited to card-not-present (online) transactions?',
      `Was any change made to card controls, merchant-category rules, 3-D Secure or fraud rules shortly before ${fmtDay(g.firstAt)}?`,
      'For the resolved tickets, what resolved them — a platform fix, a merchant-side change, or customer action?',
    ],
    nextStep: (_g, c) =>
      `Ask the card-operations owner to pull decline reason codes for the listed tickets' cards for ${c.window} and confirm or rule out a shared cause. Keep customer communication with the support team; do not change card controls on the basis of this brief alone.`,
  },
  incoming_funds: {
    unknowns: [
      'Whether the referenced wires were actually sent, and their references, amounts and value dates — amounts are customer-stated and unverified.',
      'Whether funds are held by an intermediary/correspondent bank, a compliance review, or a crediting process.',
    ],
    questions: (g, c) => [
      `Do receiving-bank or payment-rail records for ${c.window} show the referenced inbound USD transfers as received, pending, held or returned?`,
      'Is there a common intermediary bank, cut-off time, or review queue across these transfers?',
      `Did anything change in USD account details, routing or crediting jobs shortly before ${fmtDay(g.firstAt)}?`,
      c.deadlineIds.length
        ? `Which of the time-sensitive tickets (${c.deadlineIds.join(', ')}) need a proactive human status update?`
        : 'Which customers need a proactive status update?',
    ],
    nextStep: (_g, c) =>
      `Ask payments operations to trace the referenced inbound transfers with the receiving bank and check for a shared hold or delay${c.deadlineIds.length ? `, starting with the tickets that state payroll or supplier deadlines (${c.deadlineIds.join(', ')})` : ''}. Do not promise customers a crediting time until funds are confirmed.`,
  },
  fx_rate: {
    unknowns: [
      'The actual rates, spreads and mid-market references applied to these customers’ conversions.',
      'Whether FX pricing or the rate source changed during the period, or whether this reflects normal spreads that were not well explained.',
    ],
    questions: (g, c) => [
      `Did FX spread configuration or the rate source change between ${c.window}?`,
      'For a sample of these customers, how do executed rates compare with the mid-market rate at execution time?',
      'Is the in-app pricing disclosure sufficient for customers to understand the spread before converting?',
      `Are the ${g.unresolvedCount} unresolved ticket(s) waiting on a pricing explanation from a specific team?`,
    ],
    nextStep: (_g, c) =>
      `Ask the FX/pricing owner whether spreads or rate sources changed during ${c.window}, and compare a small sample of executed conversions against mid-market. Draft (do not send) a consistent explanation for support to review.`,
  },
};

const GENERIC: Playbook = {
  unknowns: ['Whether a shared system cause exists — the dataset contains customer descriptions only.'],
  questions: (_g, c) => [`Do system logs show a common error or change during ${c.window}?`, 'Are these reports one issue, or several issues with similar wording?'],
  nextStep: (_g, c) => `Assign an owner to review the listed tickets together and check system logs for a shared cause during ${c.window}.`,
};

const excerpt = (t: Ticket, max = 160) => (t.body.length > max ? t.body.slice(0, max - 1) + '…' : t.body);

/** Rule-based, template-generated brief. Every statement is computed from the member tickets and cites them. */
export function buildRuleBasedBrief(g: CandidateGroup, byId: Map<string, Ticket>): Brief {
  const members = g.ticketIds.map((id) => byId.get(id)!).filter(Boolean);
  const n = members.length;
  const window = `${fmtDay(g.firstAt)} – ${fmtDay(g.lastAt)}`;
  const ids = (ts: Ticket[]) => ts.map((t) => t.id);
  const conceptLabel = (c: string) => CONCEPTS.find((x) => x.id === c)?.label ?? c;

  // What appears to be happening
  const happening: EvidenceItem[] = g.concepts.map((c) => {
    const hit = members.filter((t) => conceptsIn(ticketText(t)).includes(c));
    return { text: `${hit.length} of ${n} tickets describe ${conceptLabel(c)}.`, ticketIds: ids(hit) };
  });
  happening.unshift({
    text: `${n} tickets from ${g.distinctCustomers ?? 'an unknown number of'} distinct customers in ${g.product.join(', ')} were created between ${window}. This is a pattern in customer reports, not a confirmed cause.`,
    ticketIds: ids(members),
  });

  // Supporting evidence — one line per ticket, quoted from source
  const evidence: EvidenceItem[] = members.map((t) => ({
    text: `${fmtDay(t.createdAt)} · ${t.status}${t.resolutionTimeHours !== null ? ` · ${t.resolutionTimeHours}h` : ''}${t.csatScore !== null ? ` · CSAT ${t.csatScore}` : ''} — “${excerpt(t)}”`,
    ticketIds: [t.id],
  }));

  // Differences and contradictions
  const differences: EvidenceItem[] = [];
  for (const c of g.concepts) {
    const miss = members.filter((t) => !conceptsIn(ticketText(t)).includes(c));
    if (miss.length) differences.push({ text: `${miss.length} ticket(s) do not mention ${conceptLabel(c)}.`, ticketIds: ids(miss) });
  }
  const byCustomer = new Map<string, Ticket[]>();
  for (const t of members) if (t.customerName) byCustomer.set(t.customerName, [...(byCustomer.get(t.customerName) ?? []), t]);
  const repeat = [...byCustomer.values()].filter((ts) => ts.length > 1);
  for (const ts of repeat)
    differences.push({
      text: `${ts.length} tickets come from the same customer, so they count once toward distinct customers (likely follow-ups).`,
      ticketIds: ids(ts),
    });
  const follow = members.filter((t) => isFollowUp(ticketText(t)));
  if (follow.length && !repeat.length) differences.push({ text: 'Some tickets are explicit follow-ups to earlier contacts.', ticketIds: ids(follow) });

  const merchantMap = new Map<string, Ticket[]>();
  for (const t of members) for (const m of merchantsIn(ticketText(t))) merchantMap.set(m, [...(merchantMap.get(m) ?? []), t]);
  if (merchantMap.size > 1)
    differences.push({
      text: `Merchants named vary: ${[...merchantMap].map(([m, ts]) => `${m} (${ts.length})`).join(', ')}. ${members.filter((t) => !merchantsIn(ticketText(t)).length).length} ticket(s) name no merchant.`,
      ticketIds: ids(members.filter((t) => merchantsIn(ticketText(t)).length)),
    });
  const inPerson = members.filter((t) => /physical purchases seem okay|works in person/i.test(t.body));
  if (inPerson.length)
    differences.push({ text: 'Some customers report in-person purchases still work, suggesting the issue may be limited to online transactions.', ticketIds: ids(inPerson) });

  const amounts = members.filter((t) => statedAmounts(t.body).length);
  if (amounts.length)
    differences.push({
      text: `Customer-stated amounts differ (${amounts.map((t) => `${t.id}: ${statedAmounts(t.body).join(', ')}`).join('; ')}). These are unverified and are not summed.`,
      ticketIds: ids(amounts),
    });
  const resolved = members.filter((t) => t.statusCategory === 'resolved');
  if (resolved.length && g.unresolvedCount)
    differences.push({
      text: `${resolved.length} ticket(s) are resolved while ${g.unresolvedCount} remain open or pending; resolution notes are not in the dataset, so it is unknown whether a shared fix was applied.`,
      ticketIds: ids(resolved),
    });
  const span = g.firstAt && g.lastAt ? (g.lastAt.getTime() - g.firstAt.getTime()) / 86_400_000 : 0;
  if (span > 5)
    differences.push({ text: `Reports are spread over ${span.toFixed(0)} days, which fits an ongoing concern better than a single event.`, ticketIds: [ids(members)[0], ids(members)[n - 1]] });

  // Potential customer impact — only explicit statements
  const impact: EvidenceItem[] = [];
  for (const t of members) for (const m of impactMatches(ticketText(t))) impact.push({ text: `“${m.phrase}” (${m.kind})`, ticketIds: [t.id] });

  const deadlineIds = [...new Set(members.filter((t) => /payroll|supplier|vendor|inventory|interrupted/i.test(t.body) && t.statusCategory === 'unresolved').map((t) => t.id))];
  const ctx: PlaybookCtx = { window, deadlineIds, inPersonIds: ids(inPerson) };
  const pb = PLAYBOOKS[g.concepts.find((c) => PLAYBOOKS[c]) ?? ''] ?? GENERIC;

  return {
    source: 'rule-based',
    generatedAt: new Date().toISOString(),
    happening,
    evidence,
    differences,
    impact,
    unknowns: [
      ...pb.unknowns,
      `Resolution notes for the ${resolved.length} resolved ticket(s) are not in the dataset.`,
      'Whether other customers were affected but did not contact support.',
    ],
    questions: pb.questions(g, ctx),
    nextStep: pb.nextStep(g, ctx),
  };
}

export function briefToMarkdown(g: CandidateGroup, b: Brief, statusLabel: string): string {
  const line = (e: EvidenceItem) => `- ${e.text} [${e.ticketIds.join(', ')}]`;
  const sec = (title: string, items: string[]) => (items.length ? `\n## ${title}\n${items.join('\n')}\n` : `\n## ${title}\n- None identified.\n`);
  return [
    `# Investigation brief — ${g.title}`,
    `Status: ${statusLabel} · ${g.ticketIds.length} tickets · ${g.distinctCustomers ?? '?'} customers · ${fmtDay(g.firstAt)} – ${fmtDay(g.lastAt)}`,
    `Generated: ${b.source === 'ai' ? `AI-assisted (${b.model ?? 'model'})` : 'rule-based template'} at ${new Date(b.generatedAt).toLocaleString()}`,
    '_Decision support only. Similar wording is not proof of a shared cause._',
    sec('What appears to be happening', b.happening.map(line)),
    sec('Supporting evidence', b.evidence.map(line)),
    sec('Differences and contradictions', b.differences.map(line)),
    sec('Potential customer impact (explicitly stated)', b.impact.map(line)),
    sec('Unknowns', b.unknowns.map((u) => `- ${u}`)),
    sec('Questions to investigate', b.questions.map((q) => `- ${q}`)),
    `\n## Suggested next step\n${b.nextStep}\n`,
  ].join('\n');
}
