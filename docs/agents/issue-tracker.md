# Issue tracker: local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file:
  - `needs-triage`: newly created or needs initial assessment
  - `ready-for-agent`: ready to be picked up and implemented by an agent
  - `claimed`: an agent or developer has claimed this ticket and is working on it
  - `blocked`: blocked by unresolved dependencies or missing information
  - `resolved`: fully implemented, tested, and verified
  - `wontfix`: closed without action
- Blocking relationships are declared near the top:
  `**Blocked by:** 01, 02` or `**Blocked by:** None (can start immediately)`
- Acceptance criteria are declared as checkboxes:
  `- [ ] Criterion 1`
  `- [x] Completed criterion`
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Visual dashboard

An interactive Project Hub dashboard is maintained at:
`.scratch/index.html`

To refresh the dashboard after modifying tickets or specs:
```bash
node ~/.agents/skills/setup/scripts/generate-hub.mjs
```

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).
Run `node ~/.agents/skills/setup/scripts/generate-hub.mjs` to refresh the visual dashboard.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user or prompt will normally pass the path or ticket number directly.

## Claiming and resolving tickets

### Prefer subagents

When implementing a ticket, dispatch a dedicated subagent for the vertical slice with a clean context. The main agent works with the operator and tracks which dependencies have been satisfied.

### Claim

Before starting, set `Status: claimed` in the ticket file.

### Resolve

Check all acceptance criteria (`- [x]`), set `Status: resolved`, and refresh the dashboard:

```bash
node ~/.agents/skills/setup/scripts/generate-hub.mjs
```
