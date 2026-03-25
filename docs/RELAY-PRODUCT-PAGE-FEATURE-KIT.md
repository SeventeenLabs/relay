# Relay Product Page Feature Kit

Last updated: March 25, 2026

## Purpose

This document is a ready-to-use source pack for building Relay product pages.
It combines positioning, feature inventory, messaging blocks, section structure, and FAQ copy.

Use this as your single source when writing:
- Homepage hero and value proposition
- Feature page copy
- Pricing and package framing
- Comparison pages
- Launch announcement page

## Product Positioning

Relay is the governed operator desk for AI agents.

Short version:
- If OpenClaw is the engine, Relay is the cockpit.

Long version:
- Relay is a desktop control plane for running AI work with human oversight.
- It is self-hosted and model-agnostic through OpenClaw routing.
- It is designed for operators and founder-led teams that need approval control, context, and traceability.

## Who Relay Is For

Primary users:
- Founder-operators
- Operations leads
- Technical agencies
- SMB teams running 1-3 practical agents

Best-fit environments:
- Teams with data sovereignty requirements
- Teams that cannot rely on cloud-only AI workflow tools
- Teams that need human approval for risky actions

## Core Product Promise

Relay helps teams run AI work from one governed desk instead of fragmented tools.

Outcomes to emphasize:
- Less context switching
- Faster decision loops
- Safer execution with approvals
- Clear operator visibility into what happened and why

## Feature Inventory

This section is split by Shipping Now versus In Build to avoid over-claiming.

### Shipping Now

#### 1) Desktop Operator Interface
- Electron app shell with React and TypeScript frontend
- Native desktop bridge for local operations
- Single app surface for Cowork, Files, Activity, Memory, Schedule, Safety, and Settings

Page copy angle:
- One operator desk instead of tab sprawl

#### 2) Chat and Cowork Task Execution
- Dedicated Chat and Cowork experiences
- New Task workflow for cowork runs
- Task state progression and run feedback
- Recents list for task and chat sessions

Page copy angle:
- From conversation to execution in one loop

#### 3) Project-Based Cowork Context
- Project model includes name, folder, optional description
- Active project selection in sidebar
- Project folder drives working context for local actions
- Project context included in approvals and task metadata

Page copy angle:
- Keep agent work grounded in the right folder and objective

#### 4) File Operations and Browsing
- Project Files view for workspace context
- Local Files view for machine-level folder access
- File tree, previews, metadata, and common actions
- Read, create, append, rename, delete, stat capabilities

Page copy angle:
- Inspect and manage execution artifacts directly where work happens

#### 5) Safety Policy and Approval Controls
- Risk-tier safety scopes: low, medium, high, critical
- Per-scope toggles for enabled and requires approval
- Blocking and approval logic based on action type
- Pending approval flow for risky actions

Page copy angle:
- Human-in-the-loop by default where risk is high

#### 6) Connectors Foundation
- Connector registry and connector model
- File System connector active
- Shell connector available and disabled by default
- Web Fetch connector available and disabled by default
- Domain allowlist support for Web Fetch

Page copy angle:
- Extensible operator tooling without losing policy control

#### 7) Schedule Visibility
- Scheduled jobs view with timeline and calendar modes
- Job status visibility and refresh workflow

Page copy angle:
- Keep recurring automation visible from the same desk

#### 8) Memory and Context Controls
- Memory entries across categories: about-me, rules, knowledge, reflection
- Memory management UI for creating and editing entries
- User preference to inject memory into agent context

Page copy angle:
- Build reusable context and reduce repeated prompting

#### 9) Usage Visibility
- Token usage tracking on messages and sessions
- Session usage and daily accumulation support

Page copy angle:
- Understand usage, not just output

#### 10) Endpoint Routing and Configuration
- Configurable OpenClaw gateway URL and token
- Health check and connection status flows
- Supports local, VPS, and custom endpoint routing patterns

Page copy angle:
- Operate where your infrastructure already runs

### In Build or Near-Term Roadmap

Use this section for roadmap pages, not hard claims on core product pages.

- Full dispatch mode with background task queue and persisted result delivery
- Server-side persistent threads as primary source of truth
- Expanded connector ecosystem (Slack, GitHub, Notion, Drive, Calendar)
- Stronger schedule authoring flows (create, edit, delete from UI)
- Deeper governance and audit tooling

Safe wording:
- Coming next
- On the roadmap
- In active development

## Differentiators You Can Use

Category-level differentiation:
- Not a chatbot wrapper
- Not a cloud-only AI coworker
- Not a zero-human autonomous company dashboard

Relay differentiators:
- Self-hosted or local-first operations model
- Model-agnostic routing through OpenClaw
- Explicit safety scopes and approval controls
- Project-bound execution context
- Desktop operator UX designed for ongoing real work

## Message Blocks You Can Reuse

### Hero Options

Option A
Headline: Governed AI operations from one operator desk
Subheadline: Relay gives operators a self-hosted, model-agnostic control plane to dispatch tasks, review outcomes, approve risky actions, and keep work grounded in project context.
Primary CTA: Get Relay
Secondary CTA: View docs

Option B
Headline: If OpenClaw is your engine, Relay is your cockpit
Subheadline: Run AI work with human oversight, safety controls, and workspace context in a desktop interface built for operators.
Primary CTA: Start local-first
Secondary CTA: Explore features

Option C
Headline: Run AI agents without giving up control
Subheadline: Centralize task execution, file context, approvals, scheduling visibility, and memory in one governed desktop app.
Primary CTA: Install Relay
Secondary CTA: Compare approaches

### Positioning Strip

- Self-hosted
- Model-agnostic
- Human-in-the-loop
- Project-scoped execution
- Operator-grade control plane

### Problem to Solution Section

Before Relay:
- Execution lives across tabs, terminals, and disconnected tools
- Folder context drifts between tasks
- Risky actions happen without clear approval boundaries
- Operators lose visibility into what changed and why

With Relay:
- One desk for dispatch, review, and oversight
- Project-bound execution context reduces folder mistakes
- Safety scopes and approvals gate risky operations
- Activity and workspace views keep outcomes visible

## Feature Section Blueprint for Product Page

Recommended order:

1. Operator Desk Overview
- Explain the control plane idea
- Show desktop shell, task surface, and oversight tabs

2. Project-Scoped Execution
- Explain projects as execution boundaries
- Explain why this reduces context drift and file mistakes

3. Governance and Safety
- Explain risk levels, scope toggles, and approval gates
- Explain human-in-the-loop behavior for sensitive actions

4. Workspace and Files
- Explain project files versus local files
- Emphasize artifact visibility and direct review

5. Connectors and Extensibility
- Explain connector model and policy-aware actions
- Mention current connectors and roadmap connectors

6. Scheduling and Memory
- Explain schedule visibility
- Explain reusable memory context

7. Deployment and Routing
- Explain local, VPS, custom gateway support
- Explain data sovereignty and infrastructure flexibility

8. CTA and Next Step
- Download, docs, or guided setup

## Feature Card Copy Starters

Card: Project-bound execution
Body: Bind every cowork run to a named project and root folder so actions stay grounded in the correct context.

Card: Approval-first risk control
Body: Require operator approval for high-risk scopes before destructive or sensitive actions proceed.

Card: Local-first file operations
Body: Inspect, create, and update files from the same interface where tasks are planned and reviewed.

Card: Extensible connector framework
Body: Add tool actions through connectors while preserving policy boundaries and operator oversight.

Card: Schedule visibility
Body: Monitor recurring jobs and upcoming runs with timeline and calendar views in one place.

Card: Endpoint flexibility
Body: Connect Relay to local, VPS, or custom OpenClaw endpoints without changing operator workflow.

## FAQ Copy (Ready to Paste)

Q: Is Relay the AI model?
A: No. Relay is the operator interface and control plane. OpenClaw handles execution and routing.

Q: Can Relay run self-hosted?
A: Yes. Relay is designed for local-first and self-hosted operation models.

Q: Is Relay tied to a single model provider?
A: No. Relay works through OpenClaw routing and supports model-agnostic operation.

Q: How does Relay handle risky actions?
A: Relay uses safety scopes, risk levels, and approval requirements to gate sensitive operations.

Q: What is the difference between Project Files and Local Files?
A: Project Files are your scoped execution context. Local Files are machine-level browsing for manual access and staging.

Q: Who should use Relay?
A: Teams and operators who need AI execution with governance, context boundaries, and data-control flexibility.

## Objection Handling Snippets

Objection: We already use chat tools.
Response: Relay is for execution governance and operator control, not just prompting.

Objection: We need strict approval controls.
Response: Relay gives configurable scope-based approvals and risk levels for sensitive actions.

Objection: We cannot lock into one model vendor.
Response: Relay is model-agnostic through OpenClaw endpoint routing.

Objection: We operate with sensitive customer data.
Response: Relay is built for self-hosted and sovereignty-oriented operating models.

## Claim Guardrails

Use these confidently:
- Desktop operator desk for AI work
- Self-hosted and local-first friendly
- Model-agnostic through OpenClaw
- Human-in-the-loop controls
- Project-scoped cowork context

Avoid unqualified claims unless implemented and validated end-to-end:
- Fully autonomous unattended operations across all workflows
- Complete enterprise compliance certification out of the box
- Guaranteed zero-risk outcomes

## Suggested Page Metadata

Title options:
- Relay | Governed AI Operator Desk
- Relay | Self-Hosted, Model-Agnostic AI Control Plane
- Relay | Human-in-the-Loop AI Operations Cockpit

Meta description options:
- Relay is a governed desktop operator desk for AI agents: self-hosted, model-agnostic, and built for human-approved execution.
- Run AI work with project context, approval gates, and workspace visibility in one local-first control plane.

Primary keyword cluster:
- AI operator desk
- governed AI operations
- self-hosted AI control plane
- human-in-the-loop AI workflow
- model-agnostic AI operations

## CTA Library

Conversion CTAs:
- Download Relay
- Start local-first
- Run your first governed task
- Open the operator desk

Evaluation CTAs:
- View docs
- See feature breakdown
- Compare deployment models
- Review governance controls

## One-Page Product Narrative (Compressed)

Relay is the governed operator desk for AI agents.
It gives operators a single desktop control plane to run tasks, review outputs, approve risky actions, and keep execution grounded in project context.

Instead of juggling chat tabs, terminals, and fragmented tooling, teams run AI work from one place with clear boundaries:
- project-scoped execution
- safety scopes and approvals
- workspace and artifact visibility
- model-agnostic endpoint routing via OpenClaw

For founder-led teams and operators that need sovereignty, oversight, and practical execution, Relay is the cockpit layer between human judgment and AI runtime.

## Build Checklist for Your Product Page

- Finalize hero line from Hero Options
- Pick 6 to 8 shipping feature cards from Shipping Now section
- Add one governance section and one project-context section
- Add FAQ block and objection handling snippets
- Add roadmap section clearly labeled as in development
- Add docs CTA and install CTA
