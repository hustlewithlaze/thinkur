"""Reproducible exploratory analysis of the support-ticket dataset.

Run: python3 analysis/eda.py [path/to/tickets.csv]
Writes nothing; prints findings to stdout. Findings are summarised in analysis/FINDINGS.md.
"""
import re
import sys

import pandas as pd

path = sys.argv[1] if len(sys.argv) > 1 else "data/support_tickets.csv"
df = pd.read_csv(path)
pd.set_option("display.width", 200, "display.max_colwidth", 90, "display.max_rows", 200)


def h(title):
    print(f"\n=== {title} ===")


h("Schema")
print(df.dtypes)
print("rows:", len(df))

h("Missing values")
print(df.isna().sum())

h("Duplicates")
print("duplicate ticket_id:", df.ticket_id.duplicated().sum())
print("exact duplicate rows:", df.duplicated().sum())
dup_text = df.groupby("ticket_body").ticket_id.count().sort_values(ascending=False)
print("bodies used by >1 ticket (templated text):", (dup_text > 1).sum(), "covering", dup_text[dup_text > 1].sum(), "tickets")

df["created"] = pd.to_datetime(df.created_at, errors="coerce")
h("Dates")
print("unparseable:", df.created.isna().sum(), "| range:", df.created.min(), "->", df.created.max())
print(df.set_index("created").resample("W").ticket_id.count())

h("Status")
print(df.status.value_counts())
print("missing resolution by status:\n", df.groupby("status").resolution_time_hours.apply(lambda s: s.isna().sum()))
print("missing csat by status:\n", df.groupby("status").csat_score.apply(lambda s: s.isna().sum()))

h("Product / segment / country")
for c in ["product", "customer_segment", "country"]:
    print(df[c].value_counts(), "\n")
print("distinct customers:", df.customer_name.nunique())
print("revenue constant per customer:", (df.groupby("customer_name").monthly_revenue_usd.nunique() == 1).all())

h("Resolution time (resolved only)")
r = df[df.status == "resolved"]
print(r.resolution_time_hours.describe())
print(r.groupby("product").resolution_time_hours.agg(["count", "mean", "median"]))

h("CSAT (resolved only)")
print(r.csat_score.value_counts().sort_index())
print(r.groupby("product").csat_score.agg(["count", "mean"]))
print("corr(resolution, csat):", round(r.resolution_time_hours.corr(r.csat_score), 2))

h("Templated vs. unique ticket bodies")
df["templated"] = df.ticket_body.map(dup_text) > 1
print(df.groupby("templated").agg(n=("ticket_id", "count"), mean_res=("resolution_time_hours", "mean"),
                                  mean_csat=("csat_score", "mean"), unresolved=("status", lambda s: (s != "resolved").sum())))

THEMES = {
    "card_decline_online": r"declin|card.*(fail|not working|stopped|rejected)|(fail|reject).*(card|AWS|Azure|Google Ads|Meta|subscription|cloud)|online card",
    "incoming_usd_wire": r"(incoming|wire|sent us|customer sent|client sent|wired).*(usd|wire|funds)|usd.*(not showing|missing|not in|do not see)",
    "fx_rate_pricing": r"rate|spread|fx pricing|conversion rate",
    "account_security": r"nobody here recognizes|do not recognize|still appears to have access|restricted",
}
h("Theme candidates (regex, for exploration only)")
for name, pat in THEMES.items():
    m = df[df.ticket_subject.str.cat(df.ticket_body, sep=" ").str.contains(pat, case=False, regex=True) & ~df.templated]
    print(f"\n-- {name}: {len(m)} tickets, {m.customer_name.nunique()} customers, "
          f"{m.created.min()} -> {m.created.max()}, unresolved={int((m.status != 'resolved').sum())}, "
          f"mean_res={m.resolution_time_hours.mean():.1f}h, mean_csat={m.csat_score.mean():.2f} (n={m.csat_score.notna().sum()})")
    print(m[["ticket_id", "created_at", "customer_name", "product", "status", "resolution_time_hours", "csat_score", "ticket_body"]].to_string(index=False))

h("Unresolved tickets")
u = df[df.status != "resolved"].sort_values("created")
print(u[["ticket_id", "created_at", "customer_name", "product", "status", "ticket_body"]].to_string(index=False))

h("Deadline / interruption language")
pat = r"payroll|supplier payment|inventory payment|pay a supplier|before services are interrupted|interrupted|urgent"
d = df[df.ticket_body.str.contains(pat, case=False) | df.ticket_subject.str.contains(pat, case=False)]
print(d[["ticket_id", "status", "ticket_subject", "ticket_body"]].to_string(index=False))

h("Follow-ups (same customer, repeated contact)")
f = df[df.ticket_body.str.contains(r"follow|same issue|still|again", case=False) & ~df.templated]
print(f[["ticket_id", "created_at", "customer_name", "status", "ticket_body"]].to_string(index=False))

h("Ticket-ID ordering vs creation time")
s = df.sort_values("created")
print("ids monotonic with time:", s.ticket_id.is_monotonic_increasing)
