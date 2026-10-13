export type StatusCategory = 'unresolved' | 'resolved' | 'other';

export interface Ticket {
  id: string;
  rowNumber: number; // 1-based line in the source CSV (header = line 1)
  createdAtRaw: string;
  createdAt: Date | null;
  customerName: string | null;
  customerSegment: string | null;
  monthlyRevenueUsd: number | null;
  country: string | null;
  product: string | null;
  subject: string;
  body: string;
  status: string; // normalised lower-case source value
  statusCategory: StatusCategory;
  resolutionTimeHours: number | null;
  csatScore: number | null;
}

export type Severity = 'error' | 'warning' | 'info';

export interface ImportIssue {
  severity: Severity;
  row?: number;
  ticketId?: string;
  field?: string;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  tickets: Ticket[];
  rejectedRows: { row: number; reason: string; raw: Record<string, string> }[];
  issues: ImportIssue[];
  headers: string[];
  missingRequired: string[];
  missingOptional: string[];
  unknownColumns: string[];
  totalDataRows: number;
}

export interface Settings {
  lowCsatThreshold: number; // resolved tickets with csat <= threshold count as low
  highAttentionMin: number;
  reviewMin: number;
  weights: {
    deadlineOrInterruption: number;
    security: number;
    crossCustomer: number;
    unresolved: number;
    lowCsat: number;
  };
  grouping: {
    similarityThreshold: number; // 0..1 cosine
    windowDays: number;
    minTickets: number;
    minCustomers: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  lowCsatThreshold: 2,
  highAttentionMin: 4,
  reviewMin: 3,
  weights: { deadlineOrInterruption: 3, security: 3, crossCustomer: 2, unresolved: 1, lowCsat: 1 },
  grouping: { similarityThreshold: 0.2, windowDays: 7, minTickets: 3, minCustomers: 2 },
};

export interface SignalMatch {
  ruleId: RuleId;
  label: string;
  points: number;
  reason: string;
  evidence?: string; // exact matched phrase from the source text
}

export type RuleId = 'deadlineOrInterruption' | 'security' | 'crossCustomer' | 'unresolved' | 'lowCsat';

export type PriorityLabel = 'High Attention' | 'Review' | 'Routine';

export interface TicketPriority {
  score: number;
  label: PriorityLabel;
  signals: SignalMatch[];
}

export type ReviewStatus = 'Candidate' | 'Needs Review' | 'Under Investigation' | 'Confirmed by Operator' | 'Dismissed';

export interface CandidateGroup {
  id: string;
  ticketIds: string[]; // sorted by created date
  title: string;
  description: string;
  concepts: string[];
  sharedTerms: string[];
  product: string[];
  distinctCustomers: number | null;
  firstAt: Date | null;
  lastAt: Date | null;
  unresolvedCount: number;
  impactStatements: { ticketId: string; phrase: string }[];
  defaultStatus: ReviewStatus;
  why: string[];
  cohesion: number; // mean pairwise similarity within group
}

export interface Note {
  id: string;
  at: string;
  text: string;
}
export interface NextAction {
  id: string;
  at: string;
  text: string;
  done: boolean;
  doneAt?: string;
}
export interface HistoryEntry {
  at: string;
  event: string;
}
export interface GroupReview {
  status?: ReviewStatus; // undefined → use group's defaultStatus
  notes: Note[];
  actions: NextAction[];
  history: HistoryEntry[];
  memberSnapshot?: string[];
}

/** A statement plus the source ticket IDs that support it. */
export interface EvidenceItem {
  text: string;
  ticketIds: string[];
}

export interface Brief {
  source: 'rule-based' | 'ai';
  model?: string;
  generatedAt: string;
  happening: EvidenceItem[];
  evidence: EvidenceItem[];
  differences: EvidenceItem[];
  impact: EvidenceItem[];
  unknowns: string[];
  questions: string[];
  nextStep: string;
}
