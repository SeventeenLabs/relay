# Relay Cowork Research Summary

Date: 2026-03-23
Purpose: Preserve market and product evidence used to define Relay MVP.

## 1. Core Market Signals

- Strong demand for cowork-style AI that can synthesize across tools and execute with human oversight.
- Highest value is operational throughput and decision support, not generic chat.
- Enterprise adoption depends on trust controls as much as model quality.

## 2. What Users Want Most

- Reliable synthesis of fragmented context (files, chat, CRM, docs, dashboards).
- Plan before execution.
- Human approval before significant actions.
- Clear rationale and traceability for recommendations.
- Reduced context switching and faster decision cycles.

## 3. Top Concerns

- Unreliability and hallucinations.
- Loss of autonomy if AI acts without oversight.
- Governance and accountability gaps.
- Privacy and data handling concerns.

Implication for Relay:

- Must make human control explicit and default.
- Must show decision rationale and policy references.
- Must provide an auditable run timeline.

## 4. Observed Cowork Patterns

Common workflow shape:

1. User defines desired outcome.
2. Cowork gathers context across local files and connectors.
3. Cowork proposes a plan.
4. User approves or modifies.
5. Cowork executes and returns structured output.
6. User iterates with follow-up prompts.

Common use cases:

- Daily executive briefing across tools.
- Customer feedback synthesis into product priorities.
- Spreadsheet and report workflows.
- Compliance and document-heavy preparation.

## 5. Customer and Enterprise Evidence Themes

- Non-technical and cross-functional teams adopt when UX is conversational and output is actionable.
- Large organizations emphasize security, admin controls, and governance from day one.
- Reported value clusters around time saved, better synthesis quality, and broader workflow coverage.

## 6. Strategic Implications for Relay

Positioning:

- Relay should be framed as a governed AI cowork interface for operations.
- OpenClaw should be framed as the backend orchestration and execution runtime.

MVP priority:

- Ship one cowork core and one production recipe.
- Validate measurable operational gains before expanding workflows.

Product principles:

- Context first.
- Human in the loop.
- Policy aware by default.
- Transparent execution.
- Measurable outcomes.

## 7. MVP Features Derived from Research

- Conversational tasking with preserved context.
- Steering loop: approve, reject, modify, hold, details.
- Policy-aware recommendation states.
- Execution timeline with non-blocking interaction.
- Results packet with receipts and suggested next actions.
- Run history with exportable audit trail.

## 8. MVP Validation KPIs

- Decision cycle time reduction.
- Weekly active usage by target operators.
- End-to-end run completion rate.
- Recommendation acceptance and override rates.
- Rework rate after execution.

## 9. Architecture Reminder

- Relay: interaction layer.
- OpenClaw: orchestration and execution.
- Claude: reasoning component inside OpenClaw.

This separation is mandatory for product messaging and implementation decisions.

## 10. Consolidated Insights Snapshot

Key strategic conclusions to carry forward:

1. The winning category is governed AI execution, not generic assistant chat.
2. Team workflows require shared context, approvals, and role-based handoffs.
3. Trust is earned through plan visibility, rationale, policy checks, and receipts.
4. Multi-user operations require a backend control plane, not just frontend UX.
5. Recipe depth in high-stakes workflows creates clearer ROI than broad shallow utility.
6. Relay should differentiate as the operator interface; OpenClaw should differentiate as the orchestration runtime.

## 11. Saved Deliverables Index

This research informed the following strategy documents:

- RELAY-POSITIONING-BRIEF.md
- RELAY-COMPETITIVE-NARRATIVE.md
- RELAY-VALUE-PROP-MATRIX.md
- RELAY-MVP-DEFINITION.md

Use these together as the current narrative stack for product, GTM, and pilot design.

Additional execution strategy stack:

- RELAY-SUCCESS-STRATEGY-DEEP-DIVE.md
- RELAY-STRUCTURE-BLUEPRINT.md
- RELAY-RISK-REGISTER.md
- RELAY-EXECUTION-HANDBOOK.md
- RELAY-NOTION-TEMPLATES.md
- RELAY-MVP-V1-FEATURES.md

