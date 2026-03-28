# Relay + OpenClaw Runtime Model (Agent, Skill, Node)

Date: 2026-03-26
Status: Canonical runtime model for product and implementation

## Purpose

This document defines how Relay should represent OpenClaw runtime concepts.

OpenClaw supports:

1. Multiple agents
2. Different skill sets per agent
3. Different execution nodes per agent or run

Relay should expose these as explicit operator choices, not hidden backend details.

## Core Runtime Objects

### 1. Node (Where work runs)

A node is a companion device or host process that connects to Gateway WebSocket
with role `node` and exposes commands through node invocation.

Examples:

- macOS node mode
- iOS or Android companion node
- Headless node host (cross-platform)

Node contract:

- id
- display name
- platform or device family
- region or location (optional)
- capabilities (for example: `system.*`, `canvas.*`, `camera.*`, `device.*`)
- limits (cpu, memory, timeout, concurrency)
- trust profile (isolated, shared, high-risk)
- health state (healthy, degraded, offline)
- permissions map (for example: screen recording, accessibility)

Operational facts:

- Nodes are peripherals, not gateways.
- Node pairing is device-pairing based; approval is required before active use.
- For remote exec, the model still runs on Gateway; Gateway forwards `exec host=node` calls to node host.
- Exec approvals are enforced on the node host.

Interpretation:

- Node answers "where this run executes".

### 2. Skill (What capabilities are available)

A skill is a reusable capability bundle attached to an agent.

OpenClaw skills are AgentSkills-compatible folders with a `SKILL.md` file and
YAML frontmatter.

A skill can include:

- Tool access (for example: fs.read, shell.exec, web.fetch)
- Prompt instructions and behavioral constraints
- Input and output schema expectations
- Safety policy defaults or required approval scopes

Load locations and precedence:

- Workspace skills: `<workspace>/skills` (highest)
- Managed/local skills: `~/.openclaw/skills`
- Bundled skills (lowest)
- Extra dirs configured by `skills.load.extraDirs` (lowest precedence)

Multi-agent fact:

- Each agent workspace has its own `skills/` directory, so per-agent skills are
	naturally isolated by workspace.

Skill contract:

- id
- name
- version
- tool grants
- policy requirements
- usage constraints
- optional dependencies

Eligibility and safety details:

- Skills are gated at load time via metadata (`requires.bins`, `requires.env`, `requires.config`, OS filters).
- Per-skill env/api keys can be injected for the duration of an agent run, then restored after run end.
- Third-party skills should be treated as untrusted and reviewed before enabling.

Interpretation:

- Skill answers "what this agent is allowed and prepared to do".

### 3. Agent (Who does the work)

An agent is the runtime identity that receives tasks and executes work using skills on a node.

Workspace semantics are core to agent identity:

- The workspace is the agent home and default cwd for workspace tools.
- Workspace is separate from `~/.openclaw/` (config, credentials, sessions, managed skills).
- The workspace is not a hard sandbox by itself; sandboxing is required for strict isolation.

Agent contract:

- id
- name
- role (for example: researcher, coder, reviewer, operator-assistant)
- model routing profile
- skill set (list of skill ids)
- memory scope
- default node or node selection policy
- approval profile

Workspace contract additions:

- workspace root path
- workspace bootstrap file set (for example: `AGENTS.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `IDENTITY.md`)
- memory files under workspace (for example: `memory/YYYY-MM-DD.md`, optional `MEMORY.md`)

Interpretation:

- Agent answers "who is responsible for this run".

## Runtime Relationship

Canonical relation:

- A run targets one primary agent
- The agent has one or more skills
- The run executes on one node (or a selected fallback node)
- The agent may invoke sub-agents, each with its own skill and node assignment

OpenClaw-aligned nuance:

- Skill eligibility is snapshot-based per session and can refresh on watcher-triggered updates.
- Multi-agent routing can use different workspaces per agent.
- Exec node binding can be global or per-agent.

## OpenClaw Operating Modes

OpenClaw can be operated in different patterns. Relay should support all three
without forcing one architecture.

### Mode A: Single primary agent

- One agent handles most tasks.
- One workspace is typically enough.
- Best for early usage and low operational complexity.

When to use:

- Solo operator.
- One product or one main operational context.

### Mode B: Primary agent that spawns sub-agents in the same workspace

- A coordinator agent delegates to spawned agents.
- Spawned agents can still operate on the same workspace root.
- This increases throughput and specialization while keeping shared context.

When to use:

- Parallel work inside one codebase or one operations folder.
- You want specialization without strict data isolation.

Tradeoffs:

- Faster collaboration between agents.
- Higher risk of context bleed or conflicting writes.

Required controls:

1. Keep one run-level workspace snapshot.
2. Attribute actions to spawned agent identity in audit logs.
3. Enforce path and approval checks the same way as primary agent actions.

### Mode C: Multi-agent with isolated workspaces

- Different agents have separate workspace roots.
- Skills and context are isolated by workspace.
- Strongest governance posture for client or domain boundaries.

When to use:

- Regulated or high-risk workflows.
- Multiple clients or business units.
- Different teams with distinct skill packs and permissions.

Tradeoffs:

- More setup and routing logic.
- Better isolation and lower accidental cross-context actions.

### Relay policy across modes

1. Always show operating mode in run details.
2. Always display effective workspace root for the current run.
3. If sub-agents are spawned, display parent-child lineage.
4. Keep approvals and activity logs agent-attributed (not only run-attributed).

## Workspace Strategy (Single vs Multiple)

This is the practical policy Relay should use.

### When one workspace is enough

Use a single workspace when:

- One operator runs one primary agent.
- Most tasks target the same codebase or operations folder.
- You want minimal configuration and low risk of routing mistakes.

Why it helps:

- Lower cognitive load for operators.
- Cleaner memory continuity.
- Fewer wrong-folder actions and approval interruptions.

### When multiple workspaces are needed

Use multiple workspaces when:

- Different agents have different domains (for example, engineering vs content ops).
- You need hard separation by client, business unit, or trust boundary.
- You run mixed workloads that should not share local context or skills.

Why it helps:

- Stronger context isolation.
- Cleaner per-agent skill layering (`<workspace>/skills`).
- Safer governance and clearer audit attribution.

### Handling rules in Relay

1. Keep one active workspace context per run.
2. Snapshot workspaceRoot at run start; never mutate mid-run.
3. If operator switches project/workspace during execution, apply only to next run.
4. Always show active workspace, agent, and node together in run header.
5. On missing or inaccessible workspace, fail closed for write-capable actions and prompt rebind.

### Product UX model

1. Default mode: Single workspace (recommended for most users).
2. Advanced mode: Multi-workspace via projects and/or per-agent workspace routing.
3. Display a clear reason for multi-workspace setups: isolation, compliance, or role separation.

### Decision heuristic

- Start with one workspace.
- Add a second workspace only when one of these is true:
	- Different data sensitivity level.
	- Different owner/team boundary.
	- Different skill packs or tool permissions are required.
	- Cross-project context bleed is causing mistakes.

## Workspace Semantics Are User-Defined

Relay should not force a single meaning for "workspace". Users define the system
model, and workspace boundaries should follow that model.

Common workspace semantics:

1. Product-based
- One workspace per product or codebase.
- Best for engineering-focused teams.

2. Client-based
- One workspace per customer account.
- Best for agencies, consulting, and compliance-heavy operations.

3. Role-based operations
- One workspace per operational role (for example: Growth Ops, Support Ops, Finance Ops).
- Best when processes and tools differ more than code repositories.

4. Risk-tier based
- Separate low-risk vs high-risk workflows.
- Best when approval policies and audit expectations differ by risk class.

Required Relay behavior:

1. Let users label workspace type (product, client, role, custom).
2. Keep execution logic identical regardless of label: one workspace snapshot per run.
3. Surface the workspace label in run headers, approvals, and exports.
4. Support mixed strategies in one installation (for example, product + client).
5. Never infer permission scope from label alone; enforce explicit policy and approvals.

Practical guidance:

- Start with the semantic model users already use to run the business.
- If people think in clients, use client workspaces.
- If people think in products, use product workspaces.
- If teams are split by role with different tools and policies, use role workspaces.

## Relay-Compatible OpenClaw Contract (Non-Prescriptive)

Relay should define a compatibility contract, not a forced topology.

That means users can model their OpenClaw system differently, as long as these
minimum contracts are satisfied.

### Minimum required contracts

1. Context contract
- Every run resolves to one effective `agentId` and one effective `workspaceRoot`.

2. Execution contract
- Every run resolves to one effective node target (explicit or default).

3. Governance contract
- Approval and policy checks apply to all consequential actions, including spawned sub-agents.

4. Audit contract
- Action logs include run id, agent id, workspace root, and node id.

5. Immutability contract
- Effective run context is snapshotted at run start and does not change mid-run.

### What is intentionally user-defined

Users may choose any of these system shapes:

1. One agent, one workspace.
2. One coordinator agent spawning sub-agents in the same workspace.
3. Multiple agents with per-agent isolated workspaces.
4. Mixed topology (some shared, some isolated) based on business needs.

Relay should support all of them when the minimum contracts above are met.

### Recommended profile templates (optional, not enforced)

1. `starter-single`
- 1 agent, 1 workspace, 1 default node.

2. `team-shared-workspace`
- coordinator + spawned agents, shared workspace, stricter write approvals.

3. `regulated-isolated`
- multiple agents, isolated workspaces, tighter policy and export-heavy auditing.

4. `hybrid-ops`
- client or product segmentation with role-specific agents and selective sharing.

Profiles should be presented as presets users can customize, not mandatory architecture.

Short form:

- Agent = identity + policy + memory
- Skill = capability package
- Node = execution host

## Relay Mapping

Relay should map OpenClaw runtime concepts into UI-level controls.

### Current Relay baseline

- Project context and working folder are operator-visible
- Safety approvals are operator-visible
- Connectors are operator-visible

### Required explicit additions

1. Agent selector
- Pick which agent receives a chat, cowork run, dispatch task, or schedule job
- Display role, skill summary, and approval profile

2. Skill visibility
- Show enabled skills for selected agent
- Show which actions come from which skill
- Explain missing capability errors as skill gaps

3. Node visibility
- Show selected node and health
- Show node capabilities and hard limits
- Allow per-run node override where policy permits

4. Run trace enrichment
- Every run record should include agentId, skillSnapshot, and nodeId
- Approval cards should include agent and node context

## Dispatch and Scheduling Contracts

### Dispatch

Dispatch payload should include at minimum:

- prompt
- project or workspace context
- agentId
- optional nodeId override
- required skills (optional hint)

Dispatch result should include:

- final status
- artifact list
- usage and cost
- execution trace with agent, skill, and node metadata

### Schedule

Scheduled job payload should include:

- name
- cron expression
- prompt template
- agentId
- optional node policy
- workspace context

## Governance Implications

OpenClaw multi-agent power increases governance surface. Relay should enforce:

1. Policy by agent role
- Different approval rules per role (for example: reviewer vs executor)

2. Policy by skill class
- Skills that include shell or network actions default to stricter approvals

3. Policy by node trust level
- Shared or remote nodes can require additional approval or restricted skills

4. Auditable identity chain
- Every consequential action must be attributable to agent + skill + node

## Data Model Recommendation for Relay Types

Use these runtime-centric shapes in app types and RPC adapters.

Node:

- id: string
- name: string
- kind: 'docker' | 'ssh' | 'managed'
- status: 'healthy' | 'degraded' | 'offline'
- capabilities: string[]
- limits?: { timeoutMs?: number; maxConcurrency?: number }
- permissions?: Record<string, boolean>

Skill:

- id: string
- name: string
- version: string
- tools: string[]
- riskLevel: 'low' | 'medium' | 'high'

AgentProfile:

- id: string
- name: string
- role: string
- model?: string
- skillIds: string[]
- defaultNodeId?: string
- workspaceRoot?: string

RunContext:

- runId: string
- agentId: string
- nodeId: string
- skillIds: string[]
- workspaceRoot: string

## Source Anchors

- Nodes: https://docs.openclaw.ai/nodes/index#nodes
- Skills: https://docs.openclaw.ai/tools/skills#skills
- Agent Workspace: https://docs.openclaw.ai/concepts/agent-workspace#agent-workspace

## UX Principles

1. Make runtime decisions explicit
- Operator should always know which agent and node are active.

2. Keep defaults safe
- Default to least-privilege skills and approval-required high-risk actions.

3. Preserve operator speed
- Agent and node presets should be one-click, not complex forms for every run.

4. Fail with diagnostics, not generic errors
- If a run fails due to missing skill or offline node, explain exactly which one.

## MVP Boundary (Recommended)

For Relay MVP, support this minimum:

1. Up to 3 selectable agents
2. Read-only skill list per agent
3. Single default node + optional override per dispatch
4. Agent and node metadata in activity timeline and approvals

That keeps the UX simple while still honoring OpenClaw's multi-agent, multi-skill, multi-node architecture.

## Positioning Guardrail

Keep wording consistent:

- OpenClaw is the execution runtime (agents, skills, nodes)
- Relay is the governed operator desk (selection, oversight, approvals, audit)

Relay should never be framed as replacing OpenClaw runtime internals.
Relay should be framed as making those internals operable and governable for humans.
