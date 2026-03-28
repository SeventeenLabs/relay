# Relay Structure Blueprint

Date: 2026-03-23
Status: Product and system blueprint

## 1. Product Structure (Top Level)

Relay should be structured as four product planes:

1. Interaction plane (Relay frontend)
- Chat, steering, details, execution timeline, history.

2. Execution plane (OpenClaw backend)
- Planning, policy checks, connector orchestration, retries, final actions.

3. Governance plane
- Approval gates, role mappings, escalation routing, audit policy.

4. Measurement plane
- KPI instrumentation, run analytics, reliability and adoption tracking.

## 2. Tenant and Collaboration Structure

Entity model:

- Organization
- Workspace
- User
- Role
- Recipe
- Run
- Approval
- Event
- Artifact

Role model (MVP simple):

- Operator: creates and steers runs.
- Reviewer: can approve/reject high-impact actions.
- Admin: manages settings, connectors, policy thresholds.

## 3. Run State Machine (Canonical)

Required run states:

- draft
- planned
- waiting_approval
- executing
- waiting_input
- completed
- failed
- canceled

Rules:

- No irreversible action before waiting_approval is resolved.
- Every transition writes an immutable event.
- UI always reflects backend truth, not local assumptions.

## 4. Recipe Structure

Each recipe should be defined by a small, explicit contract:

1. Trigger language
- What users ask for.

2. Inputs
- Which connectors and files are required.

3. Policy logic
- Thresholds, constraints, escalation paths.

4. Output schema
- Recommendation states, rationale, receipts.

5. Completion criteria
- What counts as done for this recipe.

## 5. Governance-by-Design Requirements

Every recipe should include:

1. Plan preview before action.
2. Explicit human approval for consequential writes.
3. Per-item rationale and policy reference.
4. Full run timeline and exportable audit view.

## 6. Data and Connector Structure

Connector principles:

1. Least privilege by default.
2. Workspace-scoped credentials.
3. Connector health checks visible in UI.
4. Graceful degradation when one source fails.

Data principles:

1. Tenant isolation.
2. Event immutability for audit records.
3. Separate operational metadata from customer content payloads.

## 7. UX Structure (What Users Experience)

Main shell:

1. Left: runs and navigation.
2. Center: cowork conversation.
3. Right: details and execution context.

Interaction pattern:

1. Ask task.
2. Review plan.
3. Steer.
4. Approve.
5. Execute.
6. Verify results.
7. Continue thread or close run.

## 8. Deployment Structure

Mode 1: Local
- No-login path for core cowork flow and private testing.

Mode 2: Hosted multi-user
- Shared workspace, policies, approvals, and audit layer.

Mode 3: Enterprise hosted
- Stronger controls, connector governance, and expanded compliance surface.

## 9. Roadmap Structure (By Stage)

Stage A: Prove one recipe
- Finance approvals only, high reliability, clear ROI.

Stage B: Team collaboration hardening
- Shared run ownership, assignment, comments, and escalations.

Stage C: Adjacent recipe expansion
- Daily briefing, feedback synthesis, and other policy-sensitive operations.

Stage D: Platform maturity
- Admin operations, policy lifecycle tooling, richer analytics, governance automation.

## 10. Org Structure Needed To Support Product Structure

Minimum internal ownership:

1. Product owner: recipe scope, UX quality, KPI outcomes.
2. Orchestration owner: OpenClaw reliability and connector behavior.
3. Implementation owner: pilot onboarding and customer workflow mapping.
4. Security/compliance owner: trust posture and control documentation.

## 11. Structure Health Checks

Review monthly:

1. Are workflows expanding from proof or from opinion?
2. Is governance slowing adoption or enabling confidence?
3. Are connector failures driving UX friction?
4. Is override rate trending down as product quality improves?
5. Are new customers reaching time-to-first-value quickly?

## 12. OpenClaw Runtime Object Model

Relay should explicitly model OpenClaw runtime composition:

1. Agent
- Runtime identity that receives the task.
- Owns role, model routing, memory scope, and approval profile.

2. Skill
- Capability package attached to an agent.
- Defines tool access, instructions, and policy constraints.

3. Node
- Execution host where tools and model calls run.
- Defines capabilities, limits, and health status.

Canonical run mapping:

1. Run targets one primary agent.
2. Agent uses assigned skills.
3. Work executes on one selected node.
4. Audit events should record agent + skill + node attribution.

Relay responsibility:

1. Make agent, skill, and node visible at dispatch and in run details.
2. Include this context in approval cards for risky actions.
3. Preserve runtime attribution in activity and export paths.

Reference specification:
[docs/RELAY-OPENCLAW-AGENT-SKILL-NODE-MODEL.md](docs/RELAY-OPENCLAW-AGENT-SKILL-NODE-MODEL.md)
