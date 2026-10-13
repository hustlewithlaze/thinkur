import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDate, parseTicketsCsv } from './csv';

const HEADER = 'ticket_id,created_at,customer_name,customer_segment,monthly_revenue_usd,country,product,ticket_subject,ticket_body,status,resolution_time_hours,csat_score';
const row = (o: Partial<Record<string, string>> = {}) => {
  const d = {
    ticket_id: 'T-1',
    created_at: '2026-08-01 10:00',
    customer_name: 'Acme',
    customer_segment: 'SMB',
    monthly_revenue_usd: '1000',
    country: 'Canada',
    product: 'Cards',
    ticket_subject: 'Subj',
    ticket_body: 'Body',
    status: 'resolved',
    resolution_time_hours: '2.5',
    csat_score: '4',
    ...o,
  };
  return HEADER.split(',').map((k) => d[k as keyof typeof d]).join(',');
};

describe('parseTicketsCsv', () => {
  it('parses the real challenge dataset without errors', () => {
    const r = parseTicketsCsv(readFileSync('data/support_tickets.csv', 'utf8'));
    expect(r.ok).toBe(true);
    expect(r.tickets).toHaveLength(100);
    expect(r.rejectedRows).toHaveLength(0);
    expect(r.issues.filter((i) => i.severity !== 'info')).toHaveLength(0);
    // quoted field with comma survives
    expect(r.tickets.find((t) => t.id === 'TKT-2071')!.body).toContain('$42,000 USD');
  });

  it('keeps missing optional numbers as null, never zero', () => {
    const r = parseTicketsCsv([HEADER, row({ status: 'open', resolution_time_hours: '', csat_score: '' })].join('\n'));
    expect(r.tickets[0].resolutionTimeHours).toBeNull();
    expect(r.tickets[0].csatScore).toBeNull();
    expect(r.tickets[0].statusCategory).toBe('unresolved');
  });

  it('rejects files missing required columns', () => {
    const r = parseTicketsCsv('ticket_id,created_at,status\nT-1,2026-08-01,open');
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toEqual(['ticket_subject', 'ticket_body']);
  });

  it('accepts files without optional columns and reports them', () => {
    const r = parseTicketsCsv('ticket_id,created_at,ticket_subject,ticket_body,status\nT-1,2026-08-01 09:00,Hi,Card declined,open');
    expect(r.ok).toBe(true);
    expect(r.missingOptional).toContain('csat_score');
    expect(r.tickets[0].customerName).toBeNull();
  });

  it('rejects duplicate ticket IDs explicitly, keeping the first', () => {
    const r = parseTicketsCsv([HEADER, row(), row({ ticket_body: 'second' })].join('\n'));
    expect(r.tickets).toHaveLength(1);
    expect(r.tickets[0].body).toBe('Body');
    expect(r.rejectedRows[0].reason).toMatch(/Duplicate ticket_id/);
    expect(r.issues.some((i) => i.severity === 'warning' && i.row === 3)).toBe(true);
  });

  it('rejects malformed rows and rows without IDs, with reasons', () => {
    const r = parseTicketsCsv([HEADER, row(), 'T-2,2026-08-01,too,few', row({ ticket_id: '' })].join('\n'));
    expect(r.tickets.map((t) => t.id)).toEqual(['T-1']);
    expect(r.rejectedRows).toHaveLength(2);
    expect(r.rejectedRows.map((x) => x.reason).join(' ')).toMatch(/Malformed/);
    expect(r.rejectedRows.map((x) => x.reason).join(' ')).toMatch(/Missing ticket_id/);
  });

  it('flags bad dates, numbers, CSAT scale and unknown statuses without dropping the ticket', () => {
    const r = parseTicketsCsv(
      [HEADER, row({ ticket_id: 'A', created_at: '2026-02-31 10:00' }), row({ ticket_id: 'B', resolution_time_hours: 'abc' }), row({ ticket_id: 'C', csat_score: '9' }), row({ ticket_id: 'D', status: 'escalated' })].join('\n'),
    );
    expect(r.tickets).toHaveLength(4);
    const [a, b, c, d] = r.tickets;
    expect(a.createdAt).toBeNull();
    expect(b.resolutionTimeHours).toBeNull();
    expect(c.csatScore).toBeNull();
    expect(d.statusCategory).toBe('other');
    expect(r.issues.filter((i) => i.severity === 'warning')).toHaveLength(4);
  });

  it('handles empty input and header-only files', () => {
    expect(parseTicketsCsv('').ok).toBe(false);
    const h = parseTicketsCsv(HEADER);
    expect(h.ok).toBe(false);
    expect(h.issues.some((i) => /No valid ticket rows/.test(i.message))).toBe(true);
  });
});

describe('parseDate', () => {
  it('parses local wall-clock times and rejects impossible dates', () => {
    expect(parseDate('2026-08-04 15:43')?.getHours()).toBe(15);
    expect(parseDate('2026-08-04')).not.toBeNull();
    expect(parseDate('08/04/2026')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
  });
});
