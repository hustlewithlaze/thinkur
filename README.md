# Thinkur

**Think clearly. Act decisively.**

Thinkur is an operations triage and incident-investigation tool for Loop Financial's customer-support tickets. It surfaces what needs attention now, groups reports that may share an underlying issue, explains every priority with transparent rules, and prepares evidence-grounded investigation briefs. Humans make every decision.

> Prototype built for a Business Operations Associate take-home. Priority weights are illustrative, not Loop Financial policy.

## Quick start

Requires Node 20+ (tested on Node 22). Python 3 + pandas are needed only for the optional analysis script.

```bash
npm install
npm run dev          # http://localhost:5173 (Vite + /api middleware)
# or the production build:
npm run build && npm start   # http://localhost:4173 (server/server.mjs)
```

The app opens with the bundled challenge dataset (`data/support_tickets.csv`). No API key is needed.

### Optional AI briefs

```bash
cp .env.example .env   # or export the variables directly
ANTHROPIC_API_KEY=sk-ant-... npm start
# optional: THINKUR_AI_MODEL (default claude-opus-5-5), THINKUR_AI_TIMEOUT_MS (default 45000)
```

The key is read only by the Node server (`server/ai.mjs`). The browser calls `/api/ai/brief` and never sees the key. Without a key, the server reports AI as off and the app labels every brief **Rule-based template**.

## Demo script (≈3 minutes)

1. **Overview.** There are 12 open/pending tickets. *Needs attention* ranks three candidate groups and eight unresolved tickets. Each has a plain-language reason, such as "States a payroll deadline ("affecting payroll") · Part of 'Incoming USD funds…' (8 distinct customers)". The weekly chart shows the August spike is driven by candidate-group tickets.
2. **Incident Intelligence → "Incoming USD funds reported as not visible".** Read *Why this group was surfaced*, then the brief: summary, supporting excerpts with ticket links, differences (two tickets from the same customer; customer-stated amounts that are not summed), explicit impact quotes, unknowns, questions, and a cautious next step.
3. **Decide.** Click **Start investigation**, add a note, add the next action "Request receiving-bank trace", tick it complete, then **Confirm grouping**. Try **Dismiss**: the group's tickets lose their "similar reports" points in the queue. Then **Reopen**. Click **Copy brief** to get Markdown with source IDs.
4. **Operations Queue.** Search "wire", toggle **Unresolved**, then **Urgency signals**. Sort by resolution time; missing values always sort last. Open TKT-2079 (unrecognised admin user) to see the exact rules that fired.
5. **Data & Settings.** Upload a CSV and the whole app recalculates. Validation lists rejected rows, duplicates, bad dates and non-numeric values. Change weights or grouping thresholds and **Apply & reprocess**. **Reset demo data** restores everything.

## The problem chosen, and why

Full analysis: [`analysis/FINDINGS.md`](analysis/FINDINGS.md) (reproducible via `npm run analyze`).

- 100 tickets, 27 customers, Jul 2 – Aug 13 2026. 88 resolved, 7 open, 5 pending. No duplicate IDs. Resolution time and CSAT are missing only on unresolved tickets.
- 65 tickets are repeated how-to questions (fast, CSAT ≈ 3.5). The 35 problem reports are slow (≈ 29.5h, CSAT ≈ 1.8) and hold 10 of the 12 unresolved tickets.
- Three multi-customer patterns account for 34 tickets, 10 of 12 unresolved tickets, and 23 of 38 low-CSAT resolved tickets:
  - card declines at online merchants: 14 tickets / 12 customers in under 3 days
  - incoming USD wires not visible: 9 tickets / 8 customers, with payroll and supplier deadlines
  - FX-rate complaints: 11 tickets / 10 customers
- The most consequential work is therefore spotting cross-customer patterns early and acting on unresolved, time-sensitive or security-related tickets, not answering FAQs faster. That is the workflow Thinkur supports: **identify a candidate pattern → inspect supporting tickets → review the brief → make a human decision → record the next action.**

## How it works

| Layer | File(s) | Notes |
|---|---|---|
| CSV ingestion & validation | `src/lib/csv.ts` | PapaParse. Required: `ticket_id, created_at, ticket_subject, ticket_body, status`. Every issue is reported with its line number. |
| Metrics | `src/lib/metrics.ts` | Pure functions with explicit denominators. |
| Text signals | `src/lib/text.ts` | Narrow phrase patterns that return the exact matched text. |
| Grouping | `src/lib/grouping.ts` | Deterministic; see below. |
| Priority | `src/lib/priority.ts` | Deterministic rules; see below. |
| Briefs | `src/lib/brief.ts` | Rule-based template + Markdown export. |
| AI (optional) | `server/ai.mjs` | Server-side only, schema-validated. |
| State | `src/state/store.tsx` | React context + localStorage. |
| UI | `src/pages/*`, `src/components/*` | React 19, TypeScript, Tailwind 4, Lucide. |

### Validation rules

- Missing required columns → file rejected; the previous dataset stays active.
- Rows with a missing `ticket_id` or a structurally malformed row → rejected, with the reason listed.
- Duplicate `ticket_id` → later rows rejected; the first is kept and a warning is shown.
- Bad dates, non-numeric numbers, CSAT outside 1–5, unknown statuses → the ticket is **kept**, the value is treated as missing (never zero), and a warning is shown.

### Metric definitions

- **Total tickets**: valid rows.
- **Open & pending**: status `open` or `pending`.
- **Avg resolution time**: mean of recorded times on *resolved* tickets (median shown alongside).
- **Low-CSAT resolved**: resolved tickets with CSAT ≤ threshold (default 2), over resolved tickets *with* a CSAT.
- **Groups needing review**: groups in Candidate or Needs Review.
- **Distinct customers**: unique `customer_name`; reported as "not identifiable" when any are missing.

### Candidate groups

1. **Eligibility.** Only tickets that describe a problem (a "symptom" phrase such as *declined, not showing, missing, worse, unrecognised, restricted*) and have a valid date. How-to questions are excluded, so FAQs never form "incidents".
2. **Similarity.** TF-IDF cosine over normalised words (stop words and generic terms like *payment, account, card, help* removed; light stemming), plus **concept features** that map different wordings to one symptom. For example, "rejected by Azure" and "declined at AWS" both map to *card failure* + *online merchant*.
3. **Gates.** Two tickets link only if they are in the **same product**, created within **7 days**, and similarity ≥ **0.2** (all configurable). Linked components form groups.
4. **Minimums.** A group needs at least **3 tickets from 2+ distinct customers**. Repeat contacts from one customer are not a cross-customer pattern.
5. **Description.** Title (from concepts shared by ≥ 60% of members), date range, products, unresolved count, explicit impact quotes, mean cohesion, and a "why surfaced" list.

On the challenge data this yields exactly the three patterns found in the EDA. The four unrelated account-security tickets are **not** grouped. A grouping is a hypothesis for investigation. "Confirmed by Operator" confirms the grouping is useful, not a root cause.

### Priority score (prototype)

| Rule | Points | Fires when |
|---|---:|---|
| Deadline or interruption | +3 | Text states a payroll or supplier/vendor payment dependency, or a service interruption ("stopped working", "before services are interrupted", "failing across the team"). "Can I schedule a supplier payment for next Friday?" does **not** fire. |
| Security concern | +3 | Unrecognised admin user or transaction, former employee retains access, unauthorised/fraud language. |
| Similar reports | +2 | Ticket is in a **non-dismissed** group with ≥ 2 distinct customers. |
| Open or pending | +1 | Status open/pending. |
| Low CSAT | +1 | **Resolved** with a recorded CSAT ≤ threshold. Missing CSAT never counts. |

Each rule fires at most once per ticket. Labels: **High Attention ≥ 4**, **Review ≥ 3**, otherwise **Routine** (configurable). Revenue and segment are never scored. The score is not a probability or an official severity. Every ticket shows which rules fired and the exact phrase matched.

### AI integration

- Used only to draft a group brief, and only when an operator clicks **Generate AI brief**. Arithmetic, filtering, sorting, parsing, scores and grouping never use AI.
- **Data sent:** the group title, plus ticket IDs, created dates, product, status, subject and body. Customer names are replaced with "Customer A/B/…". Revenue, segment and country are not sent. Bodies can still contain identifying details; see Security.
- **Request:** structured JSON output (`output_config.format` with a JSON schema), low effort, 45s timeout, 1 retry.
- **Validation:** the server re-validates the schema. Any statement that cites no ticket, cites a ticket outside the group, or mentions an unknown ticket ID in its text is **dropped and counted**. Malformed JSON, refusals, truncation, timeouts and provider errors return a clear error, and the UI keeps the rule-based brief.
- **Output:** supporting-evidence excerpts always come from the source records, never from the model. AI briefs are labelled with model and time, can be toggled against the rule-based brief, and are stored per group.

## Testing

```bash
npm test            # 40 unit tests (Vitest): CSV validation, metrics, signals, grouping, priority, filters/sorting, briefs, AI validation/handler
npm run typecheck
npm run build
npm run test:e2e    # builds, then Playwright (headless Chromium) against the production server:
                    #   scripts/e2e.mjs    — 21 checks: workflow + responsive (1280/1440/768/390/320)
                    #   scripts/e2e-ai.mjs — 6 checks: AI path against a local fake Anthropic endpoint
```

Screenshots from the e2e run are written to `screenshots/` (git-ignored).

### Verified in this environment

- **Unit tests:** 40/40 pass. Typecheck and production build pass.
- **Workflow e2e (21/21):**
  - metrics on Overview
  - Needs Attention reasons
  - navigation to all four sections
  - search + combined filters + empty state + clear
  - sorting with missing values last
  - ticket detail with rule breakdown
  - brief links only to member tickets
  - investigate → note → action → complete → confirm → dismiss (priority points removed) → reopen
  - persistence across reload
  - copy brief to clipboard
  - invalid upload rejected
  - valid upload with duplicates, bad dates and bad numbers replaces the dataset app-wide
  - reset
  - settings reprocess
  - no page errors
  - no horizontal overflow on every page at 1280, 1440, 768, 390 and 320px
  - mobile menu, ticket cards and workspace actions at 768/390/320
- **AI e2e (6/6):**
  - status endpoint doesn't leak the key
  - valid response renders as AI-assisted, with a fabricated `TKT-9999` citation removed
  - only pseudonymised names reach the provider
  - toggle back to rule-based
  - malformed output → error + fallback
  - provider down → error + fallback, app still usable
- **No-key path:** checked in unit tests and the main e2e run (rule-based labels, "AI not configured on server").

### Not verified

- A real call to the Anthropic API. No key was available; the fake endpoint exercises the SDK, server and UI path, but not real model output quality.
- Real mobile devices and browsers other than Chromium. Screen readers were not tested; semantic roles, labels and focus states are in place.
- Clipboard behaviour on non-secure (http, non-localhost) origins. A fallback exists, but it was only tested on localhost.
- Large datasets. Grouping is O(n²) over problem tickets, fine for thousands but not for hundreds of thousands.

## Assumptions & limitations

- CSAT is read as a 1–5 scale because the data shows integers 1–5. The low-CSAT threshold is configurable.
- There is no snapshot timestamp, so ticket "age" is shown only relative to the latest ticket in the dataset, with that caveat.
- Grouping requires the same product. A cross-product incident (e.g. Payments + Account) would show up as separate groups.
- Phrase lexicons were written against this dataset's language and would need tuning or replacing (e.g. embeddings) for real ticket volume. Anthropic does not offer an embeddings endpoint, so semantic grouping is deterministic here.
- Review state, notes and settings live in **this browser's localStorage**. There are no multi-user sync, roles or audit trail. Review state is keyed per dataset; group IDs come from the earliest member ticket, and membership changes after reprocessing are flagged.
- No SLA is provided, so none is invented. Monthly revenue is an account attribute, never exposure or money at risk. Customer-stated amounts are quoted, never summed.

## Security considerations

- The API key stays on the server. `/api/ai/status` returns only `configured`/`model`. No AI SDK code ships in the browser bundle (verified by grepping `dist/`).
- The CSV is parsed in the browser and is not uploaded to Thinkur's server. Only an explicit AI brief request sends pseudonymised ticket text, through the server, to the provider. Free-text bodies may still contain PII; production use would need redaction and a data-processing agreement.
- Request bodies are size-limited (60 tickets, 2,000 chars/field, 500 KB). The production server blocks path traversal and sets `nosniff`.
- Decision support only. Thinkur cannot move money, change permissions, freeze accounts, contact customers or close tickets.

## Hosting

Not deployed. To host: run `npm run build && npm start` on any Node host (Render, Fly.io, a VM) with `PORT`, and optionally `ANTHROPIC_API_KEY`, set. A static host (e.g. GitHub Pages) also works for everything except AI briefs; the app detects the missing API and falls back to rule-based briefs. Put authentication in front of any deployment that holds real customer data.

## Project layout

```
analysis/        eda.py (reproducible EDA) and FINDINGS.md
data/            support_tickets.csv (challenge dataset, bundled)
server/          ai.mjs (AI endpoint + validation), server.mjs (production server), ai.test.ts
src/lib/         csv, metrics, text, grouping, priority, filter, brief (+ tests)
src/state/       store (state + persistence), router (hash routes)
src/pages/       Overview, Queue, TicketDetail, Incidents, DataSettings
scripts/         e2e.mjs, e2e-ai.mjs
```
