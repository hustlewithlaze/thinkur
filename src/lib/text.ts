/**
 * Text normalisation, concept tagging and explicit-signal extraction.
 * Every pattern here is deliberately narrow and returns the exact matched phrase so the UI can show it.
 */

export const ticketText = (t: { subject: string; body: string }) => `${t.subject}. ${t.body}`;

/** Words too generic to justify grouping ("payment", "account", "help", ...) plus ordinary stop words. */
const STOP = new Set(
  `a an the and or but if of to for in on at by with from as is are was were be been being it its this that these those
  we our us i my me you your they them their he she his her there here what which who whom when where why how can could
  would should will shall may might do does did done have has had not no yes so than then too very just also any all
  some more most other such only own same into over under again further once about up down out off both each few
  per via am pm today yesterday tomorrow morning afternoon week month last next still yet now get got need needs needed
  please help question questions issue issues problem hi hello thanks thank team someone anyone something anything
  payment payments account accounts card cards money business company dashboard app thing things way say says said see
  tell know understand explain`.split(/\s+/).filter(Boolean),
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ied')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -1);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\$[\d,.]+k?/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !STOP.has(w))
    .map(stem)
    .filter((w) => !STOP.has(w));
}

/**
 * Concepts normalise different wordings of the same symptom ("rejected by Azure" ≈ "declined at AWS").
 * They are added as extra features for similarity and are used for titles and playbook questions.
 */
export interface Concept {
  id: string;
  label: string;
  pattern: RegExp;
  symptom: boolean; // describes something going wrong (vs. context)
}

export const CONCEPTS: Concept[] = [
  {
    id: 'card_failure',
    label: 'card declines or failures',
    pattern: /\b(declin\w*|reject\w*|stopped working|not working|keeps? failing|(?:are|is|were|was|still being|suddenly) (?:failing|declined)|failing|failed)\b/i,
    symptom: true,
  },
  {
    id: 'online_merchant',
    label: 'online / subscription merchants',
    pattern: /\b(aws|azure|google ads|meta ads|meta|shopify|dropbox|cloud|software|subscriptions?|hosting|online|recurring)\b/i,
    symptom: false,
  },
  {
    id: 'incoming_funds',
    label: 'incoming funds or wires',
    pattern: /\b(incoming|wire[ds]?|(?:customer|client|sender) (?:sent|says)|sent us|wired us|sender bank)\b/i,
    symptom: false,
  },
  {
    id: 'funds_not_visible',
    label: 'funds not visible or missing',
    pattern: /\b(not showing|not in (?:our|the) account|(?:do|can) ?not see|cannot see|nothing is showing|missing|not received|has not arrived|not arrived|trace an? \w+|expected it)\b/i,
    symptom: true,
  },
  {
    id: 'fx_rate',
    label: 'exchange-rate or FX pricing concerns',
    pattern: /\b(exchange[- ]rate|fx pricing|conversion rate|market rate|spread|(?:usd |the |my )rate|rate (?:looks|seems|is|this week))\b/i,
    symptom: false,
  },
  {
    id: 'pricing_dissatisfaction',
    label: 'pricing dissatisfaction',
    pattern: /\b(worse|expensive|hard to justify|far from|different from|seems high|pricing changed)\b/i,
    symptom: true,
  },
  {
    id: 'access_concern',
    label: 'unrecognised activity or access',
    pattern: /\b(nobody here recognizes|do not recognize|don't recognize|not recognized|unauthori[sz]ed|still appears to have access|did not make|didn't make|fraud\w*|compromised)\b/i,
    symptom: true,
  },
  {
    id: 'account_restricted',
    label: 'account restriction or verification hold',
    pattern: /\b(restricted|frozen|suspended|verification (?:still )?pending)\b/i,
    symptom: true,
  },
  {
    id: 'delay',
    label: 'delays or unclear status',
    pattern: /\b(delayed|has not updated|still says|returned|mismatch|does not match|which status is correct|refunded .* not see)\b/i,
    symptom: true,
  },
];

export function conceptsIn(text: string): string[] {
  return CONCEPTS.filter((c) => c.pattern.test(text)).map((c) => c.id);
}

/** True when the ticket reports a problem rather than asking an informational how-to question. */
export function hasSymptom(text: string): boolean {
  return CONCEPTS.some((c) => c.symptom && c.pattern.test(text));
}

export interface PhraseMatch {
  phrase: string;
  kind: string;
}

function findAll(text: string, patterns: { re: RegExp; kind: string }[]): PhraseMatch[] {
  const out: PhraseMatch[] = [];
  for (const { re, kind } of patterns) {
    const m = text.match(re);
    if (m) out.push({ phrase: m[0], kind });
  }
  return out;
}

/** Explicit payroll/supplier deadlines or stated service interruptions. "Can I schedule a supplier payment next Friday?" must NOT match. */
const DEADLINE_PATTERNS = [
  { re: /\b(?:affecting|for|depends? on|going out|funding)[^.]{0,40}payroll\b|\bpayroll\b[^.]{0,40}(?:depends|tomorrow|today|going out)/i, kind: 'payroll deadline' },
  { re: /\b(?:need (?:them|it|this|the funds)? ?for|need to pay|blocking)[^.]{0,30}(?:supplier|vendor|inventory)(?: payment)?[^.]{0,20}/i, kind: 'supplier/vendor payment dependency' },
  { re: /\bpay a (?:supplier|vendor) today\b/i, kind: 'supplier payment today' },
  { re: /\bbefore services are interrupted\b|\bservices? (?:is |are |were |will be )?interrupted\b/i, kind: 'service interruption' },
  { re: /\b(?:all \d+ [\w ]{0,20}cards? stopped working|stopped working)\b/i, kind: 'service interruption' },
  { re: /\bfailing across (?:the|our) team\b/i, kind: 'service interruption' },
];

const SECURITY_PATTERNS = [
  { re: /\b(?:new )?admin user[^.]*?(?:nobody here recognizes|not recogni[sz]e)/i, kind: 'unrecognised admin user' },
  { re: /\btransaction from a merchant we do not recognize\b|\bnone of our employees say they made it\b/i, kind: 'unrecognised transaction' },
  { re: /\bstill appears to have access\b/i, kind: 'former employee retains access' },
  { re: /\bunauthori[sz]ed\b|\bfraud\w*\b|\bcompromised\b|\bphishing\b/i, kind: 'unauthorised activity' },
];

/** Explicit customer-impact statements, broader than the scoring patterns (used as evidence only). */
const IMPACT_PATTERNS = [
  ...DEADLINE_PATTERNS,
  { re: /\bthree of our cards\b|\btwo employee cards\b|\bseveral online card payments\b|\ball \d+ employee cards\b/i, kind: 'multiple cards affected' },
  { re: /\bphysical purchases seem okay\b|\bworks in person\b/i, kind: 'in-person purchases unaffected' },
  { re: /\bbefore our next conversion\b|\bdo a lot of USD purchases\b/i, kind: 'upcoming conversions' },
  { re: /\bpayroll\b[^.]*/i, kind: 'payroll mentioned' },
];

export const deadlineMatches = (text: string) => findAll(text, DEADLINE_PATTERNS);
export const securityMatches = (text: string) => findAll(text, SECURITY_PATTERNS);
export function impactMatches(text: string): PhraseMatch[] {
  const seen = new Set<string>();
  return findAll(text, IMPACT_PATTERNS).filter((m) => {
    const key = m.phrase.toLowerCase();
    if ([...seen].some((s) => s.includes(key) || key.includes(s))) return false;
    seen.add(key);
    return true;
  });
}

/** Customer-stated amounts, e.g. "$118k", "$42,000". Shown as quotes only — never summed or treated as exposure. */
export function statedAmounts(text: string): string[] {
  return text.match(/\$[\d,.]+k?(?:\s?(?:USD|CAD))?/gi) ?? [];
}

/** Specific nouns worth surfacing as "differences" (merchants etc.). */
export const MERCHANTS = ['AWS', 'Azure', 'Google Ads', 'Meta', 'Shopify', 'Dropbox'];
export function merchantsIn(text: string): string[] {
  return MERCHANTS.filter((m) => new RegExp(`\\b${m}\\b`, 'i').test(text));
}

export function isFollowUp(text: string): boolean {
  return /\b(following up|follow up|same issue|again|re:)/i.test(text);
}
