# Dataset findings: `bizops_challenge_support_tickets.csv`

Reproduce with `npm run analyze` (`python3 analysis/eda.py`). Group statistics below use the three candidate groups Thinkur detects with default settings.

Labels used: **Fact** = read directly from the data · **Pattern** = repeated/associated observation · **Hypothesis** = possible explanation, unverified · **Unknown** = the data cannot answer it.

## 1. Data quality

| Check | Result |
|---|---|
| Rows / columns | 100 rows, 12 columns, matching the expected schema |
| Duplicate `ticket_id` | 0 |
| Unparseable dates | 0. Range: 2026-07-02 13:10 → 2026-08-13 15:40 (6 weeks) |
| Missing values | `resolution_time_hours` and `csat_score`: 12 each, **only on the 12 open/pending tickets** (structurally missing, not random) |
| Status | resolved 88 · open 7 · pending 5 |
| Customers | 27 distinct; `monthly_revenue_usd` is constant per customer (an account attribute, not a transaction value) |
| Ticket IDs vs time | IDs are not in creation order, so don't use ID order as a time proxy |
| CSAT | Integers 1–5 on resolved tickets only (1:15, 2:23, 3:16, 4:15, 5:19) |

There is no snapshot timestamp, assignee, channel, resolution note, transaction reference, or SLA field.

## 2. Two very different populations

- **Fact:** 65 tickets reuse 16 identical question texts across customers (e.g. "How do I change the monthly spend limit for one employee card?"). They average 7.9h to resolve and 3.5 CSAT, and only 2 are unresolved.
- **Fact:** The other 35 tickets are distinct problem reports. They average 29.5h and 1.8 CSAT, and 10 of the 12 unresolved tickets are among them.
- **Implication:** Volume-by-category dashboards would be dominated by low-impact how-to questions. Operational risk sits in the problem reports. (The templated texts suggest the dataset is partly synthetic. Treat their exact counts with care.)

## 3. Candidate patterns

| Group | Tickets | Distinct customers | Window | Unresolved | Resolved: mean / median hours | Resolved CSAT (n) |
|---|---|---|---|---|---|---|
| Card declines at online / subscription merchants (Cards) | 14 | 12 | Aug 4 08:30 – Aug 7 00:27 | 3 | 23.5 / 19.9 | 1.55 (11) |
| Incoming USD funds reported as not visible (Payments) | 9 | 8 | Aug 8 09:15 – Aug 11 14:15 | 5 | 36.7 / 39.5 | 1.75 (4) |
| Customers questioning exchange rates / FX pricing (FX) | 11 | 10 | Jul 20 – Aug 7 | 2 | 22.8 / 21.7 | 1.67 (9) |
| All other tickets | 66 | — | — | 2 | 9.7 / 6.2 | 3.52 (64) |

- **Pattern:** 34 tickets (34%) fall in these groups. They hold 10 of 12 unresolved tickets and 23 of the 38 resolved low-CSAT (≤2) tickets. The week of Aug 3 had 32 tickets, 22 of them in candidate groups.
- **Card declines.** *Pattern:* 12 customers report card declines within ~2.7 days, mostly at online/subscription merchants (AWS, Google Ads, Azure, Meta, Shopify, Dropbox, "cloud", "software"). Two say in-person purchases still work (TKT-2063, TKT-2064). NovaFleet filed 3 of the 14 tickets (follow-ups). *Hypothesis:* a change affecting card-not-present transactions (issuer/processor rules, MCC controls, 3-D Secure). *Unknown:* decline codes and whether the cause was on Loop's side, the issuer's, the network's, or the merchants'.
- **Incoming USD funds.** *Pattern:* 8 customers report inbound USD wires not visible within ~3.2 days. Four tickets state payroll or supplier dependencies (TKT-2071, 2074, 2077, 2085), and one says a large inventory payment is blocked (TKT-2073). *Hypothesis:* a shared delay or hold in inbound USD crediting. *Unknown:* whether the wires were actually sent. Amounts ($31.5k–$118k) are customer-stated and **must not be summed into an exposure figure**; TKT-2072 and TKT-2085 cite the same $118k wire.
- **FX pricing.** *Pattern:* 10 customers question rates over ~2.5 weeks, and two say pricing "changed" (TKT-2052, TKT-2057). This is a slower, ongoing concern rather than an outage. *Hypothesis:* a spread or rate-source change, or normal spreads that are poorly explained. *Unknown:* the rates actually applied.

## 4. Important singletons (not one incident)

TKT-2079 (unrecognised admin user, **open**), TKT-2080 (former controller retains access), TKT-2082 (unrecognised $4,850 card transaction), TKT-2081 (account restricted ahead of payroll, **pending**). They share "account/access" vocabulary but describe different situations, so Thinkur deliberately does **not** group them. They are surfaced individually through the security and deadline priority rules.

## 5. Statistical cautions

- Resolution time correlates with CSAT (r = −0.73 on resolved tickets), but ticket type (how-to vs. problem) confounds it. Don't read it as "faster replies raise CSAT" without controlling for type.
- Group-level CSAT means rest on 4–11 tickets. Treat them as directional.
- Averages: resolution time is right-skewed (mean 14.0h, median 8.65h, max 67.8h), so Thinkur shows both.
- No ticket text establishes that a payment failed, settled, or was received. Tickets are customer descriptions.
- Keyword matching is fragile. A naive "rate" regex matched "corpo**rate**" in a card ticket during exploration, which is why Thinkur combines narrow phrase patterns with product, time and distinct-customer gates.

## 6. Product decision

The data supports the **operations triage and incident investigation** hypothesis:

1. **Evidence:** three time-clustered, multi-customer patterns hold most unresolved and low-CSAT tickets.
2. **Impact:** explicit payroll/supplier deadlines and a possible security issue are sitting in open/pending tickets.
3. **Feasibility:** subject/body text, product, timestamps and customer names are enough to group and prioritise transparently.
4. **Evaluability:** groups and scores can be checked ticket by ticket against source text.

Alternatives considered:
- **Self-serve deflection for the 65 templated how-to tickets.** Highest volume, but they are already fast with middling-to-good CSAT, so the impact is lower. Thinkur reports their count as a side insight.
- **An FX pricing-transparency project.** A real pattern, but it is a product/pricing decision rather than an operations workflow. Thinkur still surfaces it as a candidate group.
