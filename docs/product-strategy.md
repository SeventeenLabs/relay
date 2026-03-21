# Relay Product Strategy (One-Page)

## 1) Product Thesis
Relay should win as the operator cockpit for OpenClaw: local-first, approval-driven automation that stays reliable while OpenClaw evolves quickly.

Core promise:
- Give users agentic execution across local files, tools, and schedules.
- Keep humans in control with plan -> approve -> execute -> review.
- Absorb upstream OpenClaw change behind stable product behavior.

## 2) Market Context

### Current market for Claude Cowork / Claude for Work
- Individual power users: desktop task automation, local files, quick report workflows.
- Team users: cross-functional work (marketing, sales, product, legal, ops, engineering) with shared context and connectors.
- Enterprise buyers: governance-heavy AI adoption with SSO, SCIM, audit logs, data controls, usage controls.

### Current market for GitHub Copilot
- Individual developers and students: IDE-first coding acceleration.
- Engineering teams: code review, coding agents, terminal workflows, repo-native automation.
- Enterprise engineering: policy, auditability, model choices, managed agent access and integrations.

## 3) Your Best Wedge Market

Primary wedge (first 6-12 months):
- Technical founders, solo operators, and 5-50 person teams with high operational load.
- Users who need local file workflows and trustworthy approvals, not only chat.
- Teams that value self-hosted or controllable OpenClaw backends.

Expansion market (12+ months):
- SMB/mid-market Ops teams (RevOps, BizOps, Support Ops, PMO, Compliance Ops).
- Product and engineering-adjacent teams needing recurring, auditable automations.

## 4) Ideal Customer Profile (ICP)

### ICP A: Founder-Operator (0-20 employees)
- Pain: too many repetitive operational tasks across files and tools.
- Trigger: wants automation without losing approval control.
- Win metric: weekly hours saved on recurring tasks.

### ICP B: Ops Team Lead (20-200 employees)
- Pain: recurring reporting and data synthesis from fragmented sources.
- Trigger: manual process churn and inconsistent outputs.
- Win metric: cycle time reduction and fewer handoff errors.

### ICP C: Engineering/Platform Lead (50-500 employees)
- Pain: AI tools are fragmented and difficult to govern.
- Trigger: need policy and auditability for agent actions.
- Win metric: adoption with governance, without blocking velocity.

## 5) Positioning and Messaging

Category:
- Agentic desktop operations layer for OpenClaw.

Positioning line:
- "Relay is the local-first control plane for OpenClaw automations: plan, approve, execute, and audit real work."

Message pillars:
- Reliability under change: stable UX despite OpenClaw updates.
- Human control: approvals before impactful actions.
- Local-first execution: desktop files and folders as first-class context.
- Repeatable outcomes: recipes and schedules, not one-off prompts.

## 6) Feature Priority Matrix (Now / Next / Later)

### Now (0-6 weeks)
- Capability negotiation at connect time (available methods/scopes/version).
- Unified run lifecycle states and explicit failure recovery actions.
- Local file workflow hardening: dry run, selective apply, collision handling.
- Clear bridge/runtime diagnostics in-app.

### Next (6-12 weeks)
- Recipe system (saved workflows with parameters).
- Scheduled execution with retries and run history.
- Approval queue UI with per-step review.
- Execution timeline with artifacts and status transitions.

### Later (3-6 months)
- Team policy controls (path allowlists, action policies, connector permissions).
- Exportable audit reports and compliance-friendly run logs.
- Multi-workspace memory and reusable org playbooks.
- Controlled plugin/connector marketplace.

## 7) KPI Dashboard Spec

### Activation KPIs
- Time to first successful run.
- Time to first approved plan.
- % of users completing first local-file workflow.

### Engagement KPIs
- Weekly active operators.
- Runs per active user per week.
- % of users with at least one saved recipe.
- % of users with at least one recurring schedule.

### Reliability KPIs
- Run success rate.
- Partial-failure rate.
- Retry success rate.
- Median recovery time after failure.

### Trust/Governance KPIs
- Approval rate (approved vs rejected plans).
- % runs with complete audit trail.
- Policy violation events per 100 runs.

### Business KPIs
- Weekly hours saved (self-reported + modeled).
- Retention by cohort (week 1/4/8).
- Team expansion: seats per workspace.

## 8) 90-Day Milestones

Milestone 1 (Days 1-30): Reliability foundation
- Ship capability negotiation + robust run states + actionable errors.
- Target: >=95% successful completion for supported workflows.

Milestone 2 (Days 31-60): Repeatable automation
- Ship recipes + schedule retries + run history.
- Target: >=40% WAU using at least one saved recipe.

Milestone 3 (Days 61-90): Team readiness
- Ship approval queue + audit log export + basic policy controls.
- Target: 3-5 pilot teams with weekly recurring automations.

## 9) Risks and Mitigations
- Upstream API volatility -> isolate through adapter and capability flags.
- User trust gaps -> mandatory plan preview and explicit approvals.
- Local automation fear -> dry-run defaults and rollback manifest.
- Feature sprawl -> prioritize repeatability and reliability before breadth.
