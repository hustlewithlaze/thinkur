import Papa from 'papaparse';
import type { ImportIssue, ImportResult, StatusCategory, Ticket } from './types';

export const REQUIRED_COLUMNS = ['ticket_id', 'created_at', 'ticket_subject', 'ticket_body', 'status'] as const;
export const OPTIONAL_COLUMNS = [
  'customer_name',
  'customer_segment',
  'monthly_revenue_usd',
  'country',
  'product',
  'resolution_time_hours',
  'csat_score',
] as const;

const UNRESOLVED = new Set(['open', 'pending', 'new', 'in progress', 'in_progress', 'on hold', 'on_hold', 'waiting']);
const RESOLVED = new Set(['resolved', 'closed', 'solved', 'done']);

export function categorizeStatus(status: string): StatusCategory {
  if (UNRESOLVED.has(status)) return 'unresolved';
  if (RESOLVED.has(status)) return 'resolved';
  return 'other';
}

/** Parses "YYYY-MM-DD HH:mm" (or ISO) as a local wall-clock time. Returns null when not a real date. */
export function parseDate(raw: string): Date | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +se);
  // Reject roll-overs such as 2026-02-31
  if (date.getFullYear() !== +y || date.getMonth() !== +mo - 1 || date.getDate() !== +d) return null;
  if (+h > 23 || +mi > 59) return null;
  return date;
}

function parseNumber(raw: string | undefined): { value: number | null; invalid: boolean } {
  if (raw === undefined) return { value: null, invalid: false };
  const s = raw.trim();
  if (s === '') return { value: null, invalid: false };
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? { value: n, invalid: false } : { value: null, invalid: true };
}

const blankToNull = (v: string | undefined) => (v === undefined || v.trim() === '' ? null : v.trim());

export function parseTicketsCsv(text: string): ImportResult {
  const issues: ImportIssue[] = [];
  const rejectedRows: ImportResult['rejectedRows'] = [];
  const empty: ImportResult = {
    ok: false,
    tickets: [],
    rejectedRows,
    issues,
    headers: [],
    missingRequired: [],
    missingOptional: [],
    unknownColumns: [],
    totalDataRows: 0,
  };

  if (!text || !text.trim()) {
    issues.push({ severity: 'error', message: 'The file is empty.' });
    return empty;
  }

  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const headers = (parsed.meta.fields ?? []).filter((h) => h !== '');
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  const missingOptional = OPTIONAL_COLUMNS.filter((c) => !headers.includes(c));
  const known = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
  const unknownColumns = headers.filter((h) => !known.has(h));
  const base = { ...empty, headers, missingRequired, missingOptional, unknownColumns, totalDataRows: parsed.data.length };

  if (missingRequired.length) {
    issues.push({ severity: 'error', message: `Missing required column(s): ${missingRequired.join(', ')}.` });
    return base;
  }
  for (const c of missingOptional)
    issues.push({ severity: 'info', field: c, message: `Optional column "${c}" not present; related views and rules are disabled.` });
  if (unknownColumns.length)
    issues.push({ severity: 'info', message: `Ignored unrecognised column(s): ${unknownColumns.join(', ')}.` });

  // Rows Papa flagged as structurally malformed (wrong field count, bad quotes)
  const malformed = new Map<number, string>();
  for (const e of parsed.errors) if (e.row !== undefined && e.row !== null) malformed.set(e.row, e.message);

  const seen = new Map<string, number>();
  const tickets: Ticket[] = [];

  parsed.data.forEach((raw, i) => {
    const row = i + 2; // header is line 1 (approximate for multi-line quoted fields)
    if (malformed.has(i)) {
      const reason = `Malformed row: ${malformed.get(i)}`;
      rejectedRows.push({ row, reason, raw });
      issues.push({ severity: 'error', row, message: reason });
      return;
    }
    const id = (raw.ticket_id ?? '').trim();
    if (!id) {
      rejectedRows.push({ row, reason: 'Missing ticket_id', raw });
      issues.push({ severity: 'error', row, field: 'ticket_id', message: 'Row rejected: missing ticket_id.' });
      return;
    }
    if (seen.has(id)) {
      const reason = `Duplicate ticket_id (first seen on row ${seen.get(id)}); first occurrence kept`;
      rejectedRows.push({ row, reason, raw });
      issues.push({ severity: 'warning', row, ticketId: id, field: 'ticket_id', message: `Row rejected: ${reason}.` });
      return;
    }
    seen.set(id, row);

    const createdAtRaw = (raw.created_at ?? '').trim();
    const createdAt = parseDate(createdAtRaw);
    if (!createdAt)
      issues.push({
        severity: 'warning',
        row,
        ticketId: id,
        field: 'created_at',
        message: `Unparseable created_at "${createdAtRaw}"; ticket kept but excluded from date-based views and grouping.`,
      });

    const status = (raw.status ?? '').trim().toLowerCase();
    const statusCategory = categorizeStatus(status);
    if (statusCategory === 'other')
      issues.push({
        severity: 'warning',
        row,
        ticketId: id,
        field: 'status',
        message: `Unrecognised status "${raw.status ?? ''}"; counted as neither open/pending nor resolved.`,
      });

    const num = (field: string) => {
      const r = parseNumber(raw[field]);
      if (r.invalid)
        issues.push({
          severity: 'warning',
          row,
          ticketId: id,
          field,
          message: `Non-numeric ${field} "${raw[field]}"; treated as missing (not zero).`,
        });
      return r.value;
    };
    const resolution = num('resolution_time_hours');
    let csat = num('csat_score');
    const revenue = num('monthly_revenue_usd');

    if (resolution !== null && resolution < 0) {
      issues.push({ severity: 'warning', row, ticketId: id, field: 'resolution_time_hours', message: `Negative resolution time ${resolution}; treated as missing.` });
    }
    if (csat !== null && (csat < 1 || csat > 5)) {
      issues.push({ severity: 'warning', row, ticketId: id, field: 'csat_score', message: `CSAT ${csat} is outside the 1–5 scale; treated as missing.` });
      csat = null;
    }
    if (statusCategory === 'unresolved' && resolution !== null)
      issues.push({ severity: 'info', row, ticketId: id, message: 'Unresolved ticket has a resolution time recorded; excluded from the resolution-time average.' });

    const subject = (raw.ticket_subject ?? '').trim();
    const body = (raw.ticket_body ?? '').trim();
    if (!subject && !body)
      issues.push({ severity: 'warning', row, ticketId: id, message: 'Ticket has no subject or body text; it cannot be grouped.' });

    tickets.push({
      id,
      rowNumber: row,
      createdAtRaw,
      createdAt,
      customerName: blankToNull(raw.customer_name),
      customerSegment: blankToNull(raw.customer_segment),
      monthlyRevenueUsd: revenue,
      country: blankToNull(raw.country),
      product: blankToNull(raw.product),
      subject,
      body,
      status,
      statusCategory,
      resolutionTimeHours: resolution !== null && resolution >= 0 ? resolution : null,
      csatScore: csat,
    });
  });

  if (tickets.length === 0) issues.push({ severity: 'error', message: 'No valid ticket rows were found.' });

  return { ...base, ok: tickets.length > 0, tickets, rejectedRows, issues };
}
