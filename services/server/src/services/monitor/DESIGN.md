# Monitor Agent Loop — Design

## Overview

The monitor agent continuously watches incoming traces for a project and surfaces semantic issues via the kanban board. It operates as a background loop that processes items through the board's columns.

## Columns & Transitions

```
Queue → Investigating → Needs Review → Done
```

### Queue (entry point)

Two sources create items here:

1. **Developer watch requests** — manually created via the UI with a title and optional description (e.g. "Watch for cases where the summarizer drops key facts")
2. **Agent scan** — the agent periodically analyzes recent traces and creates tickets for anything worth investigating

### Queue → Investigating

The agent picks up items from the queue and begins deeper analysis.

- For **developer watch requests**: reads the request, starts looking for matching patterns in traces
- For **agent-created items**: starts gathering more evidence to confirm or reject the initial finding

### Investigating → Needs Review (or → Done)

The agent has enough evidence. It:

- Writes up findings in the description (markdown with trace links, counts, patterns)
- Moves to **Needs Review** if the issue is confirmed
- Moves to **Done** (dismissed) if it turns out to be a false positive

### Needs Review → Done

Developer reviews the findings and either resolves or dismisses (via UI).

## Agent Loop Mechanics

A single background job per project, running on a schedule or triggered by new traces.

Each run processes work in priority order:

1. **Continue investigating** — pick up items in "investigating" status, query more traces, update findings
2. **Pick up queue items** — move items from "queue" to "investigating", begin analysis
3. **Scan for new issues** — analyze recent traces that haven't been seen, create new queue items if warranted

### Core pattern

Every step follows the same structure:

```
context (item + traces) → AI call → update item (description + status)
```

The difference between steps is:
- What **context** is provided (the item's current state, which traces to look at)
- What **prompt** is used (scan vs investigate vs report)
- What **output** is expected (new item vs updated description vs final report)

## Prompt Templates

### 1. Scan — "Find new issues"

**Input:**
- Recent traces for the project (last N hours, or since last scan)
- Project context / memory (later)

**Prompt idea:**
> You are monitoring an AI agent's traces. Review the following traces and identify any semantic issues — not just errors, but problems with reasoning, intent following, hallucination, context loss, or output quality. Only flag issues that are meaningful and actionable.

**Output:**
- List of issues to create as Queue items (title + initial description)
- Or nothing, if traces look healthy

### 2. Investigate — "Dig deeper"

**Input:**
- The monitor item (title, description, any prior findings)
- Relevant traces (filtered by the item's context — e.g. specific endpoint, trace name, time range)

**Prompt idea:**
> You are investigating this potential issue: "{title}". {description}
>
> Analyze the following traces for evidence. Look for patterns, frequency, root causes. Determine if this is a real issue or a false positive.

**Output:**
- Updated description with findings so far
- Decision: keep investigating (stay in "investigating"), promote to "review", or dismiss to "done"

### 3. Report — "Summarize for the developer"

**Input:**
- The monitor item with all accumulated findings

**Prompt idea:**
> Write a clear, actionable summary of this issue for a developer to review. Include: what's happening, how often, which traces are affected, and any suggested next steps.

**Output:**
- Final markdown description
- Status → "review"

## Open Questions

- **Scheduling**: How often does the loop run? Per-project cron? On new trace ingestion?
- **Budget/limits**: How many AI calls per run? Per project? Daily cap?
- **Trace selection**: How do we pick which traces to feed? Sample? All? Only new since last scan?
- **State tracking**: How does the agent know which traces it has already seen? Cursor/timestamp?
- **Project memory**: Later — agent builds understanding of what's normal for this project
- **Auto-evals**: Later — agent defines code-based checks that run on every incoming trace
