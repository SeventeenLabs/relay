# Relay MVP Definition

> Last updated: March 24, 2026

---

## Relay = ?

**Relay is the governed operator desk for your AI agent.**

Cowork is a personal AI worker for knowledge workers â€” cloud-hosted, Claude-only, $20-200/mo.
Paperclip is an AI company OS for autonomous businesses â€” 20+ agent org charts, heartbeats, company templates.

**Relay is neither.**

Relay is the self-hosted, model-agnostic, human-in-the-loop control plane for operators who run 1-3 AI agents and need real governance over what those agents do. It's the middle ground: more serious than a chatbot, more personal than a company OS.

| | Cowork | Paperclip | **Relay** |
|---|---|---|---|
| **For** | Knowledge workers | Autonomous businesses | Operators / founders |
| **Agents** | 1 (Claude) | 20+ (any) | 1-3 (any) |
| **Hosting** | Anthropic cloud | Self-hosted | **Self-hosted / local-first** |
| **Model** | Claude only | Any | **Any (OpenClaw native)** |
| **Governance** | Lightweight | Full company | **Operator-grade** |
| **Core UX** | Chat + deliverables | Dashboard + tickets | **Operator desk** |
| **Price** | $20-200/mo | Free (OSS) | **Free (OSS)** |
| **Identity** | AI coworker | AI company | **AI operator desk** |

**One-line:** If OpenClaw is the engine, Relay is the cockpit.

---

## MVP Scope

The MVP proves one core loop:

> **Dispatch a task â†’ agent works â†’ operator reviews results â†’ approves or redirects â†’ work is done.**

Everything below serves that loop. Nothing outside it ships in MVP.

---

## MVP Features (Detailed)

### 1. Dispatch Mode (Priority: CRITICAL)

**What it is:** Assign a task to the agent and walk away. Come back to completed work.

**Current state:** Chat and Cowork pages require sitting and watching. No background execution. No task status polling. No "come back later" pattern.

**MVP scope:**
- New "Dispatch" action: user writes a task prompt, selects a working context (folder or project), hits "Dispatch"
- Task enters a queue with status: `dispatched` â†’ `working` â†’ `review` â†’ `completed` / `failed`
- Gateway streams the work in the background; Relay polls for status + results
- When the agent finishes, the result appears as a reviewable deliverable (not an ephemeral chat message)
- User can review, approve, request changes, or reject
- Notification when task completes (Electron system notification)
- Task list view showing all dispatched tasks with statuses

**Key behaviors:**
- App can be minimized/backgrounded while agent works
- Results persist server-side (gateway) â€” not just localStorage
- Optionally, results also cached locally for offline access
- Task prompt, result, and all intermediate steps are traceable

**Implementation notes:**
- Extend gateway client with `dispatch.create`, `dispatch.status`, `dispatch.list`, `dispatch.result` RPC methods
- Add `DispatchPage` component under `src/features/dispatch/`
- Add types: `DispatchTask`, `DispatchStatus`, `DispatchResult`
- Use Electron `Notification` API for completion alerts
- Sidebar shows dispatch tasks alongside chat/cowork recents

**Acceptance criteria:**
- [ ] User can dispatch a task and close the main window
- [ ] Task status updates in real-time when window is reopened
- [ ] Completed results are viewable with full trace
- [x] System notification fires on task completion
- [ ] Dispatched tasks persist across app restart

---

### 2. Memory â†’ Context Injection (Priority: CRITICAL)

**What it is:** Memory entries actually affect agent behavior by being injected into the system prompt.

**Current state:** Memory page (about-me, rules, knowledge, reflection) stores entries in localStorage. They are never sent to the agent. Memory is decorative.

**MVP scope:**
- On every message send (chat, cowork, dispatch), serialize relevant memory entries into the system prompt
- Injection format: structured block at the end of the system prompt, categorized
- Categories map to injection priority:
  - `rules` â†’ always injected (behavioral constraints)
  - `about-me` â†’ always injected (identity/context)
  - `knowledge` â†’ injected when relevant tags match the prompt (or always, if small enough)
  - `reflection` â†’ injected as recent context
- Total injection budget: ~2000 tokens max. If entries exceed budget, prioritize rules > about-me > latest reflection > tagged knowledge
- Memory entries synced to gateway (if available) so Dispatch tasks also get memory context

**Implementation notes:**
- Add `buildMemoryContext(entries: MemoryEntry[]): string` function in `src/lib/memory-context.ts`
- Call before `sendMessage()` / `dispatchTask()` â€” prepend to system prompt
- Settings page: toggle "Inject memory into conversations" (default: on)
- Token estimation: rough character count / 4

**Acceptance criteria:**
- [ ] Memory entries appear in the system prompt sent to the agent
- [ ] Agent behavior visibly changes based on rules/about-me entries
- [ ] Memory injection can be toggled off in settings
- [ ] Works for chat, cowork, and dispatch modes

---

### 3. Cost & Token Tracking (Priority: HIGH)

**What it is:** Show the user how much each interaction costs.

**Current state:** Zero cost visibility. No token counts. No usage tracking.

**MVP scope:**
- Parse token usage from gateway response metadata (input tokens, output tokens, total)
- Display per-message token count in chat/cowork (small badge on each message)
- Session summary: total tokens used in current session
- Running total: all-time token usage (persisted in localStorage)
- If gateway provides cost data (price per token Ã— usage), show estimated cost in USD
- Cost dashboard in sidebar or settings: daily/weekly usage chart (simple bar chart)

**Implementation notes:**
- Extend `ChatMessage` with optional `usage?: { inputTokens: number; outputTokens: number; model: string }`
- Parse from gateway stream `done` frame or response metadata
- Add `TokenBadge` component: shows token count on hover
- Add `UsageSummary` component in sidebar footer: "Session: 12.4k tokens (~$0.03)"
- Persist daily totals in localStorage keyed by date

**Acceptance criteria:**
- [ ] Every assistant message shows token count
- [ ] Session total visible in sidebar
- [ ] Running total persisted across sessions
- [ ] Cost estimate shown when price data available

---

### 4. Approval Gates (Wired) (Priority: HIGH)

**What it is:** When the agent wants to perform a dangerous action, Relay pauses and asks the operator for approval.

**Current state:** Safety page defines 12 permission scopes with risk levels â€” but nothing is enforced. Agents act without approval.

**MVP scope:**
- When the agent response contains a `relay_action` flagged as requiring approval (based on Safety page scope settings), Relay:
  1. Pauses execution
  2. Shows an approval card: action type, target path, risk level, details
  3. Operator clicks Approve, Reject, or Modify
  4. If approved â†’ execute action, send receipt
  5. If rejected â†’ send rejection message to agent, agent can adjust
- Scope mapping (from existing Safety page):
  - `file_delete` â†’ approval if enabled
  - `file_write_outside_workspace` â†’ approval if enabled
  - `shell_execute` â†’ always approval (critical)
  - `network_request` â†’ approval if enabled
  - `data_export` â†’ approval if enabled
- Approval decisions logged in Activity page as auditable events

**Implementation notes:**
- Add `ApprovalGate` component: intercepts relay_actions before execution
- Modify cowork/dispatch action execution pipeline to check scope permissions
- Add `ApprovalDecision` type: `{ actionId, scope, decision: 'approved'|'rejected'|'modified', timestamp, reason? }`
- Store decisions in activity history
- Sound/notification for pending approvals

**Acceptance criteria:**
- [ ] File delete actions pause for approval when scope is enabled
- [ ] Approval card shows action details and risk level
- [ ] Approved actions execute; rejected actions notify the agent
- [ ] All decisions appear in Activity log
- [ ] At least 3 scope types enforced (file_delete, shell, network)

---

### 5. Schedule Creation (Priority: HIGH)

**What it is:** Users can create recurring tasks from the UI, not just view existing cron jobs.

**Current state:** Schedule page displays cron jobs from gateway (read-only). No creation UI.

**MVP scope:**
- "New scheduled task" button on Schedule page
- Form fields:
  - Task name
  - Task prompt (what the agent should do)
  - Schedule: preset options (every hour, daily at 9am, weekly Monday, custom cron)
  - Working context (folder/workspace)
  - Enabled toggle
- On save â†’ send to gateway via `cron.create` RPC
- Edit existing: click a job â†’ edit form pre-filled â†’ `cron.update` RPC
- Delete: context menu â†’ `cron.delete` RPC
- Visual confirmation: newly created jobs appear in the timeline/calendar view

**Implementation notes:**
- Add `ScheduleFormDialog` component with shadcn Dialog + form
- Add cron expression builder (preset buttons + freeform input for advanced)
- Extend gateway client: `createCronJob()`, `updateCronJob()`, `deleteCronJob()`
- Validate cron expression client-side before sending

**Acceptance criteria:**
- [ ] User can create a new scheduled task from the UI
- [ ] Preset schedule options work (daily, weekly, custom)
- [ ] Created jobs appear in schedule view
- [ ] Jobs can be edited and deleted
- [ ] Jobs actually execute on schedule (gateway-dependent)

---

### 6. Connector Framework (Priority: HIGH)

**What it is:** A pluggable system for connecting Relay to external tools.

**Current state:** Settings page has a "Connectors" placeholder. Zero integration logic.

**MVP scope (3 connectors for MVP):**

**Framework:**
- Connector interface: `{ id, name, icon, status, configure(), test(), actions[] }`
- Connector registry in settings: list installed connectors, add new ones
- Each connector provides actions the agent can invoke (e.g., `slack.send_message`, `github.create_issue`)
- Connector actions exposed to the agent via gateway RPC extensions or system prompt injection

**MVP Connectors:**

1. **File System (local)** â€” already built, formalize as connector
   - Actions: read, write, list, delete, rename, stat
   - Status: working

2. **Web Fetch** â€” simple HTTP GET/POST
   - Actions: `web.fetch(url)` â†’ returns page content
   - Configuration: allowed domains list (safety)
   - Use case: research, API calls, checking services

3. **Shell / Terminal** â€” execute commands in working directory
   - Actions: `shell.exec(command)` â†’ returns stdout/stderr
   - Configuration: allowed commands list, blocked commands, timeout
   - Approval gate: always requires approval (critical scope)
   - Use case: run tests, build projects, git operations

**Future connectors (not MVP):** Slack, GitHub, Google Drive, Notion, Calendar

**Implementation notes:**
- Create `src/lib/connectors/` with connector interface + registry
- Each connector is a module: `src/lib/connectors/filesystem.ts`, `web-fetch.ts`, `shell.ts`
- Connector status shown in Settings â†’ Connectors tab
- Agent-facing: connector actions described in system prompt so agent knows what tools are available

**Acceptance criteria:**
- [x] Connector interface defined and documented
- [x] File system connector formalized
- [x] Web fetch connector works with domain allowlist
- [x] Shell connector works with approval gate enforcement
- [x] Settings page shows connector status and configuration
- [ ] Agent can discover and invoke connector actions

---

### 7. Persistent Threads (Server-Side) (Priority: MEDIUM)

**What it is:** Chat/cowork/dispatch history stored on the gateway, not just localStorage.

**Current state:** All threads and messages persisted in localStorage. Lost if browser data clears. Can't sync across devices. Dispatch won't work without server-side persistence.

**MVP scope:**
- On message send/receive, persist to gateway via `thread.save` RPC
- On app load, restore from gateway via `thread.list`, `thread.get`
- localStorage as cache/fallback â€” gateway as source of truth
- Thread metadata: id, title, type (chat/cowork/dispatch), created, updated, message count
- Graceful degradation: if gateway unavailable, use localStorage only

**Implementation notes:**
- Extend gateway client: `saveThread()`, `listThreads()`, `getThread()`, `deleteThread()`
- Add sync logic in App.tsx: on mount â†’ pull thread list from gateway â†’ merge with localStorage
- Conflict resolution: gateway wins (newer timestamp)
- Migration: first run after update â†’ push existing localStorage threads to gateway

**Acceptance criteria:**
- [ ] Threads persist on gateway
- [ ] App can restore threads from gateway on fresh install
- [ ] localStorage acts as cache
- [ ] Works offline (falls back to localStorage)
- [ ] Thread deletion syncs both sides

---

### 8. Artifact Panel (Priority: MEDIUM)

**What it is:** Rich output display for agent deliverables beyond plain markdown.

**Current state:** Cowork right panel shows local file action buttons only. Chat has no right panel. Agent output is always rendered as markdown.

**MVP scope:**
- When agent produces a file (via relay_action `create_file`), display it in the right panel:
  - Code files: syntax-highlighted viewer
  - HTML: sandboxed iframe preview
  - CSV/JSON: table view
  - Markdown: rendered preview
  - Images: display
- Panel shows a tab per artifact (multiple outputs per task)
- Each artifact has: download button, copy button, "apply to workspace" button
- Panel persists per session â€” switching back to a completed task shows its artifacts

**Implementation notes:**
- Create `ArtifactPanel` component in `src/features/cowork/artifact-panel.tsx`
- Create `ArtifactViewer` with type-specific renderers
- Wire to relay_action receipts: when `create_file` succeeds, add to artifact list
- Use `iframe sandbox` for HTML preview (security)
- Tab bar with filename + icon

**Acceptance criteria:**
- [ ] Created files appear as artifacts in the right panel
- [ ] Code files render with syntax highlighting
- [ ] HTML files render in sandboxed preview
- [ ] Artifacts can be downloaded
- [ ] Multiple artifacts per session supported

---

## What is NOT in the MVP

| Excluded | Why |
|---|---|
| Multi-agent orchestration / org charts | That's Paperclip's territory |
| Drag-and-drop workflow builder | Against product philosophy |
| Mobile companion app | Post-MVP; Dispatch + Electron notifications cover the core need first |
| Multi-workspace switching | Post-MVP; focus on single workspace excellence |
| Slack/GitHub/Notion connectors | Post-MVP; framework ships in MVP, specific integrations follow |
| Agent-to-agent delegation | Post-MVP; single-operator, 1-3 agent model first |
| User accounts / team features | Post-MVP; single-operator use case first |
| Custom themes beyond light/dark | Cosmetic, not functional |
| Plugin marketplace | Post-MVP; plugin system exists server-side already |

---

## MVP Success Criteria

The MVP is done when a user can:

1. **Open Relay** and connect to an OpenClaw gateway
2. **Set up memory** with their name, role, rules, and domain knowledge
3. **Dispatch a task** ("Organize my downloads folder by file type") and close the window
4. **Get notified** when the task is done
5. **Review the results** â€” see what files were moved, read the agent's reasoning
6. **Approve a dangerous action** â€” agent wants to delete duplicates, Relay pauses and asks
7. **See what it cost** â€” 8,400 tokens, ~$0.02
8. **Schedule a recurring task** ("Every Monday, scan my project for TODO comments and create a summary")
9. **Use a connector** â€” agent runs `shell.exec("npm test")` with approval
10. **Trust the audit trail** â€” every action, approval, and result is logged in Activity

That's the loop. That's the MVP. Everything else is iteration.

---

## Architecture Notes for MVP

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  RELAY (Electron)                â”‚
â”‚                                                  â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚   Chat   â”‚  â”‚  Cowork  â”‚  â”‚   Dispatch    â”‚  â”‚
â”‚  â”‚   Page   â”‚  â”‚   Page   â”‚  â”‚    Page       â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚       â”‚              â”‚               â”‚           â”‚
â”‚  â”Œâ”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚           Message Pipeline                  â”‚  â”‚
â”‚  â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚  â”‚
â”‚  â”‚  â”‚ Memory  â”‚ â”‚ Approval â”‚ â”‚  Connector   â”‚  â”‚  â”‚
â”‚  â”‚  â”‚ Inject  â”‚ â”‚  Gate    â”‚ â”‚  Actions     â”‚  â”‚  â”‚
â”‚  â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                        â”‚                         â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚         Gateway Client (WebSocket RPC)      â”‚  â”‚
â”‚  â”‚  + dispatch.*  + thread.*  + cron.*         â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                        â”‚                         â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚        Electron Bridge (IPC)                â”‚  â”‚
â”‚  â”‚  File ops, Shell exec, Notifications        â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                         â”‚
                         â–¼
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚  OpenClaw Gateway â”‚
              â”‚  (RPC Server)     â”‚
              â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## Build Order

| Phase | Features | Depends on |
|---|---|---|
| **Phase 1** | Memory â†’ context injection | Nothing (standalone) |
| **Phase 1** | Cost/token tracking | Nothing (parse gateway responses) |
| **Phase 2** | Approval gates (wired) | Safety page data (exists) |
| **Phase 2** | Connector framework + shell/web-fetch | Approval gates (shell needs approval) |
| **Phase 3** | Persistent threads (server-side) | Gateway RPC extensions |
| **Phase 3** | Schedule creation | Gateway RPC extensions |
| **Phase 4** | Dispatch mode | Persistent threads + memory injection + approval gates |
| **Phase 4** | Artifact panel | Dispatch results + connector outputs |

Phase 1 is pure frontend. Ship it in days.
Phase 2 is frontend + Electron bridge. Ship it in a week.
Phase 3 requires gateway cooperation. Ship when gateway RPCs land.
Phase 4 is the capstone. Dispatch is the product-defining feature.

---

## Positioning Summary

> **Cowork** = a personal AI worker for knowledge workers ($20-200/mo, cloud, Claude-only)
>
> **Paperclip** = an AI company OS for autonomous businesses (open-source, 20+ agents, zero-human)
>
> **Relay** = the governed operator desk for your AI agent (self-hosted, model-agnostic, human-in-the-loop)

Relay's moat: **governance + local-first + model freedom.** You own your data, you choose your model, you approve every important action. Cowork can't promise local-first. Paperclip is overkill for one operator with one agent. Relay is the right tool for the right scale.

---
---

# SeventeenLabs Business Model & Monetization Strategy

> How SeventeenLabs earns money with Relay and the broader product platform.

---

## The Core Thesis

**Businesses that want AI in their operations but don't want to use Cowork (or can't).**

Why can't they / won't they use Cowork?

| Reason | Who | Size |
|---|---|---|
| **Data sovereignty** | Regulated industries (finance, healthcare, legal, gov), EU companies with GDPR concerns | Large |
| **Model lock-in** | Companies that want to use multiple models, fine-tuned models, or open-weight models | Growing fast |
| **Cost control** | Teams burning $200/mo/seat on Claude Max and wanting their own infrastructure | Medium |
| **Customization** | Companies needing deep integration with proprietary systems, not generic connectors | Large |
| **Compliance** | Organizations requiring audit trails, approval workflows, and governance that Cowork's lightweight controls don't cover | Enterprise |
| **Ownership** | Founders/CTOs who philosophically want to own their AI stack, not rent it | Indie/SMB |

These are SeventeenLabs customers.

---

## Revenue Model: Open Core + Services

Relay is open-source (MIT). This is correct and should stay. The OSS version is the acquisition engine. Revenue comes from everything around it.

### Revenue Stream 1: Relay Pro / Enterprise (Software License)

**The n8n / Windmill model** â€” free self-hosted, paid for enterprise features.

| | Relay Community (Free) | Relay Pro | Relay Enterprise |
|---|---|---|---|
| **Price** | $0 | ~â‚¬49-99/mo per operator | Custom (â‚¬500+/mo) |
| **Hosting** | Self-hosted | Self-hosted | Self-hosted or managed |
| **Core features** | Chat, Cowork, Dispatch, Files, Memory, Activity, Schedule, Safety | Everything in Community | Everything in Pro |
| **Connectors** | File system, Shell, Web fetch | + Slack, GitHub, Google Drive, Notion, Calendar, CRM | + Custom connector SDK, unlimited |
| **Governance** | Basic approval gates | + Role-based approvals, approval chains, delegation rules | + Multi-approver workflows, compliance templates, policy engine |
| **Audit** | Activity log (local) | + Persistent audit trail, export to CSV/JSON | + Immutable audit log, log streaming (Datadog, etc.), retention policies |
| **Memory** | localStorage | + Gateway-synced memory, team memory sharing | + Org-wide knowledge base, memory governance |
| **Cost tracking** | Per-message token counts | + Budgets per workspace, alerts, daily/weekly reports | + Cost allocation by team/project, billing integration |
| **Schedule** | View + create | + Advanced cron, conditional triggers, dependency chains | + SLA monitoring, escalation rules |
| **Multi-workspace** | Single workspace | + Up to 5 workspaces | + Unlimited, workspace templates |
| **Users** | Single operator | + Up to 5 operators | + Unlimited, SSO/SAML, SCIM |
| **Support** | Community (Discord/GitHub) | Email support, 48h response | Dedicated Slack, SLA, onboarding |

**Why this works:** n8n does â‚¬30M+ ARR with this model. Windmill charges â‚¬120/mo for enterprise. The free tier gets adoption; paid tiers capture value when companies need governance, compliance, team features, and support.

**Key pricing insight:** Don't charge per AI execution or per token â€” that competes with the model provider. Charge per **operator seat** and **feature tier**. The value is governance, not compute.

---

### Revenue Stream 2: Core Platform (The Backend)

SeventeenLabs already has a "Core" product on the website: *"The Core platform unifies company context, governance, and agentic execution into a controllable operating layer for AI."*

**Core is the server-side counterpart to Relay.** Relay is the cockpit; Core is the flight computer.

| What Core provides | Why it's paid |
|---|---|
| Context layer API â€” unified company data, goals, constraints, team structure | Companies don't want to build this themselves |
| Governance engine â€” approval workflows, policy rules, role-based access | Compliance teams require this |
| Agent orchestration â€” manage 2-10 agents across projects with state, retries, rollback | Operational reliability |
| Enterprise memory â€” searchable, permissioned, org-wide knowledge store | IP protection and institutional memory |
| Observability â€” quality metrics, drift detection, latency, cost per workflow | Exec reporting |

**Pricing:** Platform license. â‚¬200-2,000/mo depending on scale. Sold alongside Relay Enterprise or standalone.

**This is the real business.** Relay gets you in the door. Core is the platform companies pay for long-term.

---

### Revenue Stream 3: Implementation Services (Professional Services)

SeventeenLabs already positions as "Partnership Over Consulting" with proven results (â‚¬50k+ average annual ROI per client, 40% time saved, 3-6 months to deploy).

| Service | Price range | Scope |
|---|---|---|
| **AI Operations Audit** | â‚¬3,000-8,000 | Assess current workflows, identify automation opportunities, produce prioritized roadmap |
| **Relay Deployment** | â‚¬5,000-15,000 | Install, configure, connect to existing stack, train team, first 3 workflows live |
| **Custom Connector Build** | â‚¬2,000-10,000 per connector | Build custom connectors for proprietary or niche systems (ERP, CRM, internal tools) |
| **Governance Design** | â‚¬5,000-20,000 | Design approval workflows, permission scopes, compliance templates, audit requirements |
| **AI Agent Setup** | â‚¬3,000-15,000 | Configure OpenClaw or other agents with business-specific context, memory, skills, and safety rules |
| **Ongoing Operations** | â‚¬2,000-5,000/mo retainer | Monitor, optimize, expand â€” fractional AI operations team |

**Why this works:** The website already claims 12+ opportunities found per audit. This is the fastest path to revenue while the product matures. Services fund product development.

**Margin structure:** Services are 60-70% margin (it's your time + AI leverage). Software is 80-90% margin at scale. Services first, product revenue compounds over time.

---

### Revenue Stream 4: Workflow Templates & Marketplace (Future)

Similar to Paperclip's "ClipMart" concept but for operator workflows, not company templates.

| Asset type | Example | Price model |
|---|---|---|
| **Workflow templates** | "Weekly stakeholder report from Slack + GitHub + Linear" | Free (acquisition) or $19-49 per premium template |
| **Connector packs** | Industry-specific connector bundles (Legal pack: Clio + DocuSign + iManage) | â‚¬29-99/mo subscription |
| **Governance templates** | SOC2-ready approval workflows, GDPR data handling rules, HIPAA compliance gates | â‚¬99-299 per template pack |
| **Skills marketplace** | Community-contributed agent skills with revenue share | 70/30 creator split |

**Timeline:** Post-MVP. Requires adoption first. But design Relay's connector and template interfaces now to enable this later.

---

## Competitive Moat Against Cowork

This is the central strategic question: **Why would a business pay SeventeenLabs when they can just use Cowork at $20-200/mo per person?**

### What Cowork CANNOT offer:

| Capability | Cowork | Relay + Core |
|---|---|---|
| **Self-hosted / on-prem** | No. Your data goes to Anthropic. | Yes. Data stays on your infrastructure. |
| **Model choice** | Claude only | Any model: GPT-4, Claude, Llama, Mistral, Gemini, fine-tuned models |
| **Custom governance** | "Shows you the plan, waits for approval" â€” one-size-fits-all | Configurable per scope, per role, per risk level, with audit trails |
| **Cost predictability** | Rate-limited, opaque pricing, "consumes limits faster" | Pay for your own compute; full token/cost visibility |
| **Enterprise compliance** | Limited audit trail, no SOC2-specific controls | Immutable audit logs, compliance templates, log streaming |
| **Team memory / org knowledge** | Per-user only | Shared, permissioned, org-wide knowledge base |
| **Custom integrations** | 80+ plugins (but Anthropic-controlled ecosystem) | Build your own connectors; no platform dependency |
| **Offline / air-gapped** | No | Yes (local-first architecture) |
| **White-label / embed** | No | Yes (Enterprise tier) |

### The pitch to businesses:

> "Cowork is great for individual knowledge workers. But if your company needs to own its AI infrastructure, choose its own models, enforce real governance, and keep data on-prem â€” you need Relay."

---

## Go-to-Market Sequence

### Phase 1: Services-Led (Now â†’ 6 months)
- Lead with AI Operations Audits and Relay Deployments
- Every services engagement produces a live Relay installation
- Charge for the work, give Relay Community Edition for free
- Build case studies and proven ROI metrics
- **Revenue: â‚¬5-15k per engagement, 2-4 clients/month = â‚¬10-60k/mo**

### Phase 2: Product-Led (6-12 months)
- Launch Relay Pro with team features, advanced connectors, and persistent audit
- Self-serve signup â†’ download â†’ connect gateway â†’ upgrade when needed
- Services clients become Pro/Enterprise upgrades automatically
- **Revenue: â‚¬49-99/mo Ã— growing operator base + services pipeline**

### Phase 3: Platform-Led (12-18 months)
- Launch Core as the backend platform
- Sell Relay + Core as a stack to mid-market companies
- Partner channel: agencies and consultants deploy Relay + Core for their clients
- Connector and governance template marketplace opens
- **Revenue: Platform licenses + marketplace take rate + partner revenue share**

---

## Pricing Sanity Check

| Comparison | Their price | What they offer | Relay equivalent |
|---|---|---|---|
| Cowork Max | $200/mo/seat | Single AI worker, cloud | Relay Pro at â‚¬49-99/mo gives more governance + model freedom |
| n8n Business | â‚¬667/mo | Workflow automation, 40k executions | Relay Enterprise at similar range gives AI-native operations |
| Windmill Enterprise | â‚¬120/mo + compute | Developer workflows | Similar tier, different audience (ops vs. dev) |
| Paperclip | Free (OSS) | Full company OS | Relay Community is free too; Pro/Enterprise for governance |

**Key insight:** Relay Pro at â‚¬49-99/mo is cheaper than Cowork Max ($200/mo) AND gives you data ownership + model choice. That's a real value pitch.

---

## What SeventeenLabs is NOT

- Not a model lab (don't build or train models)
- Not an agent framework (don't tell people how to build agents)
- Not a chatbot company (Relay is an operator desk, not a chat interface)
- Not a consulting-only shop (services fund the product, but the product is the business)

## What SeventeenLabs IS

**An AI operations company that helps businesses integrate AI into daily operations with governance and control.**

- **Relay** = the governed operator desk (open-source desktop app)
- **Core** = the AI operations platform (server-side, paid)
- **Services** = the implementation partner that deploys and configures it all
- **Marketplace** = the ecosystem where governance templates, connectors, and skills compound

The revenue ladder: **Services â†’ Relay Pro â†’ Core Platform â†’ Marketplace**. Each rung funds the next and builds on the last.

