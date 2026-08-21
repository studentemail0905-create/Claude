# Deliverables Reference

One deliverable per audit: an interactive HTML report published as a Claude Artifact.
No PDF generation, no Python dependencies, no external fonts to install. The client
opens a link, explores the audit in their browser, and can print/export it to PDF
themselves later if they want a static copy.

**Before writing any HTML**, load the `artifact-design` skill and the `dataviz` skill
(for the stat tiles, tables, and any severity/status coloring). This report is a
data-dense document/UI hybrid — treat it as "utilitarian but polished," not editorial:
real typographic hierarchy and a considered palette, no oversized hero, no flourishes
that don't earn their place.

---

## Building the report

Write the report as a single self-contained HTML file, then publish it with the
`Artifact` tool.

- **Title**: `[Client Name] SEO Audit` — a name, not a caption.
- **Description** (artifact publish param): one sentence, e.g. "SEO audit and
  competitive analysis for [Client Name] in [city]."
- **Favicon**: 1-2 emoji fitting an audit/report, e.g. 🔍 or 📊. Keep it stable across
  redeploys of the same audit.
- Extract brand colors from the live site per SKILL.md Step 1b and use them as the
  accent token throughout — both light and dark palettes. Brand colors are accents
  (headers, rules, badges, stat tiles), never full-page backgrounds. If extraction
  fails, choose a professional palette that fits the client's industry.
- Design both themes (light and dark) per the artifact-design skill's token pattern —
  the client may open this in either.

---

## Structure requirements

This deliverable is meant to be explored, not just scrolled through top to bottom:

- **Sticky section nav** (anchor links to each section below) so the client can jump
  around instead of scrolling linearly. On narrow viewports this can collapse to a
  simple top bar.
- **Executive summary at the top**: market context, one-sentence verdict, and a stat
  row (competitors reviewed, keywords, quick wins, blockers) as stat tiles — see the
  dataviz skill for stat tile treatment. This replaces the old PDF's "stat callout bar."
- **Every table is a real HTML `<table>`** — competitor feature matrix, keyword tiers,
  technical audit — never an image or a screenshot. The client should be able to
  select and copy rows straight into their own spreadsheet.
- **Hard blockers get distinct severity styling** — a critical/red treatment (left
  border stripe or chip), visually separated from quick wins. Never mix blockers and
  quick wins in the same list.
- **Quick wins are a ranked, numbered list** — each row shows impact, effort, and a
  time estimate (see SKILL.md Step 5 — estimate from what you actually found, not
  preset numbers).
- **Technical audit table** shows PASS / WARN / FAIL per category. Sort FAIL and WARN
  rows first so problems surface immediately; a lightweight status filter (show
  all/FAIL/WARN) is a nice-to-have if it's not much extra effort, not a requirement.
- **Print stylesheet** (`@media print`): collapse the sticky nav, expand anything
  collapsed, force light backgrounds and dark text regardless of the viewer's theme.
  This is how the client exports a clean PDF later if they want one — via their
  browser's own Print → Save as PDF, not a build step this skill runs.

---

## Required sections (in order)

1. **Header** — client name, "SEO Audit & Competitive Analysis", date, "Prepared by
   [agency_name]" (replaces the old cover page — no page numbers or TOC page needed,
   the sticky nav serves as the table of contents)
2. **Executive summary** — market context, one-sentence verdict, stat tile row
   (competitors, keywords, quick wins, blockers)
3. **Business overview & site analysis** — what they do, current site status, issue
   table
4. **Competitor analysis** — 6-8 competitor profiles + feature comparison matrix
5. **Keyword research** — 4 tiers, table per tier
6. **Technical SEO audit** — PASS / WARN / FAIL per category, hard blockers visually
   distinct
7. **Content strategy** — page roadmap + top 10 blog posts
8. **Quick wins** — ranked by impact ÷ effort, time estimates, blockers called out
   separately
9. **Strategic opportunities** — 3 specific opportunities, not generic advice
10. **Closing** — [agency_name] executes the work; the audit is the pitch

---

## Publishing

Write the HTML to the scratchpad directory, then call the `Artifact` tool with that
file path, the title, description, and favicon above. Share the resulting link with
the client in the closing message — keep that message to 2-3 sentences.

If the audit is later revised, redeploy by calling `Artifact` again with the same
file path so the link stays stable rather than creating a second copy.
