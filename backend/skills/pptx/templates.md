# PPTX Slide Templates Catalog

Use this catalog when preparing `slides[]` for the `create_presentation` tool.
Goal: avoid repetitive text-only slides and pick the best layout for the message.

## Research-backed design rules (applied here)

- Lead with a clear takeaway headline per slide (assertion-first).
- Prefer visual grouping over dense paragraphs.
- Use comparison/timeline/process structures for analytical content.
- Keep data slides focused on 2-6 key numbers, not full data dumps.
- Vary layouts across the deck to maintain attention and clarity.

References:
- Microsoft PowerPoint best practices: concise text + visual hierarchy
  https://support.microsoft.com/powerpoint
- Assertion-Evidence approach (headline + evidence structure)
  https://www.assertion-evidence.com
- Visual communication heuristics (readability/scannability)
  https://www.nngroup.com

## Template Decision Guide

Pick template by intent:

- `insight`: default explanatory slide with bullets.
- `comparison`: A vs B tradeoffs, before/after, options.
- `timeline`: chronological progression, roadmap, milestones.
- `metrics`: KPI-heavy slide with prominent numbers.
- `process`: ordered steps or workflow.
- `quote`: memorable statement + attribution.
- `two-column`: bullets on one side, explanation/context on the other.

## Template Specs

### 1) `insight`
Best for:
- General explanatory points.

Input:
- `title`
- `bullets` (recommended) or `content`

### 2) `comparison`
Best for:
- Option A vs Option B
- Current state vs target state

Input:
- `title`
- `template: "comparison"`
- `leftTitle`, `rightTitle` (optional but recommended)
- `bullets` with either:
  - prefixed items: `Left: ...`, `Right: ...`
  - or paired format: `Left point | Right point`

### 3) `timeline`
Best for:
- Milestones, release plan, evolution story.

Input:
- `title`
- `template: "timeline"`
- `bullets` in chronological order (3-5 items works best)

### 4) `metrics`
Best for:
- KPI snapshot, impact summary, business outcomes.

Input:
- `title`
- `template: "metrics"`
- `bullets` formatted as `Label: Value`
  - example: `Revenue Growth: +28%`

### 5) `process`
Best for:
- Step-by-step method, lifecycle, operating model.

Input:
- `title`
- `template: "process"`
- `bullets` as ordered steps (max 6 recommended)

### 6) `quote`
Best for:
- Vision statement, customer quote, key principle.

Input:
- `title`
- `template: "quote"`
- `content` for quote text (preferred)
- `source` for attribution (optional)

### 7) `two-column`
Best for:
- Left: key points, Right: explanation/context/examples.

Input:
- `title`
- `template: "two-column"`
- `bullets` for left column
- `content` for right column

## Example `slides[]` with varied templates

```json
[
  {
    "title": "2026 AI Adoption Snapshot",
    "template": "metrics",
    "bullets": [
      "Teams using copilots: 68%",
      "Cycle time reduction: -22%",
      "Automation coverage: 41%",
      "Annualized savings: $4.2M"
    ]
  },
  {
    "title": "Where We Are vs Where We Need to Be",
    "template": "comparison",
    "leftTitle": "Current",
    "rightTitle": "Target",
    "bullets": [
      "Left: Siloed workflows",
      "Right: Unified AI orchestration",
      "Left: Manual triage",
      "Right: Policy-based automation"
    ]
  },
  {
    "title": "Implementation Roadmap",
    "template": "timeline",
    "bullets": [
      "Q1: Foundation and pilot teams",
      "Q2: Workflow automation rollout",
      "Q3: Governance and model tuning",
      "Q4: Scale to all business units"
    ]
  },
  {
    "title": "Execution Model",
    "template": "process",
    "bullets": [
      "Define business objective",
      "Map process bottlenecks",
      "Deploy focused copilots",
      "Measure outcomes weekly",
      "Scale what delivers ROI"
    ]
  },
  {
    "title": "Operating Principle",
    "template": "quote",
    "content": "Automate the repeatable so teams can focus on judgment and strategy.",
    "source": "AI Transformation Office"
  }
]
```

## Recommended deck rhythm

For 6-8 content slides, a strong rhythm is:

1. `insight` (context)
2. `metrics` (why it matters)
3. `comparison` (options/tradeoffs)
4. `timeline` or `process` (execution)
5. `two-column` (details)
6. `quote` or `metrics` (close with conviction)

