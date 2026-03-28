# Relay Cowork Projects

> Last updated: March 25, 2026

## What a Project Is

A Relay Cowork project is a saved operator context that binds:

- `title` (required): human-readable workstream name
- `folder` (required): local root directory used by Cowork file actions
- `description` (optional): intent, owner, constraints, or notes

A project does not duplicate files or create a new workspace by itself. It points Cowork to the folder you choose.

## Why Projects Exist

Projects prevent context drift.

Without projects, operators can accidentally run tasks against the wrong folder. With projects, selecting a project switches Cowork into a known folder context and keeps local actions grounded in that root.

## One Folder vs Multiple Folders

### Use one folder when possible

One folder is best when your work is mostly one product or one operational context.

Benefits:

- less setup and faster dispatch
- lower chance of selecting the wrong root
- cleaner continuity in memory and activity

### Use multiple folders when isolation is required

Multiple folders are useful when workstreams should not share context.

Typical reasons:

- separate clients
- separate products or business units
- different risk or compliance boundaries
- different tool or skill expectations per workstream

### Relay handling model

1. Each run uses exactly one folder snapshot.
2. Folder switch during a run does not affect that run.
3. Next run uses the newly selected folder.
4. Missing or inaccessible folder should block write-capable actions until rebind.

Practical rule: start with one folder, then split into multiple projects only when isolation or governance needs demand it.

## Structure Recommendation

Use one project per real workstream.

Good examples:

- `Client Alpha Website` -> `C:/Projects/client-alpha-site`
- `Marketing Ops Q2` -> `D:/Ops/marketing-q2`
- `SaaS Product Core` -> `C:/Dev/my-saas`

Avoid:

- Very broad folders like `C:/` or your whole `Downloads`
- Mixing multiple unrelated clients/products into one project

## How It Works Internally

1. You create a project from the left sidebar (`Projects` section -> `+`).
2. Relay stores it in local app storage (`relay.cowork.projects.v1`).
3. Relay stores active project selection (`relay.cowork.projects.active.v1`).
4. When a project is selected, Relay updates the current Cowork working folder.
5. If you manually edit the working folder while a project is active, Relay updates that project's folder path.

This keeps the active project and effective working folder in sync.

## Formal Behavior Contract

### Project Contract

1. A Project is the execution boundary for Cowork local actions.
2. One Project maps to one root folder path.
3. Every Cowork run binds to exactly one project context snapshot.
4. Project context snapshot includes at minimum:
   - project id
   - project title
   - root folder
   - run start timestamp
5. If no project is active, write-capable local actions must be blocked or require explicit temporary folder confirmation.

### Runtime Rules

1. `activeProject` is global for Cowork at any moment.
2. Starting a run snapshots `runContext.projectId` and `runContext.rootFolder`.
3. Changing active project mid-run does not mutate current run context.
4. New runs use the latest active project.
5. All local action paths must be normalized and validated against `runContext.rootFolder`.
6. Any resolved path outside project root must be blocked or escalated according to safety policy.

### Safety and Approvals Rules

1. Project defines where actions execute.
2. Safety policy defines if actions are allow/block/approval-required.
3. Approval payload should include:
   - project title
   - action type
   - target path
   - risk level
4. Out-of-root path attempts should always be treated as high-risk behavior.

### Persistence Rules

1. Projects persist in local storage key `relay.cowork.projects.v1`.
2. Active project persists in local storage key `relay.cowork.projects.active.v1`.
3. On startup:
   - if active project exists, restore it
   - if project folder is unavailable, require re-selection/rebind before write actions

### Path and Platform Rules

1. Resolve and normalize paths before boundary checks.
2. On Windows, comparisons should be case-insensitive.
3. Symlink resolution should use resolved real paths before validating root boundaries.

## How To Use (Operator Flow)

1. Open Cowork view.
2. In left sidebar, go to `Projects` and click `+`.
3. Enter:
   - Title
   - Optional description
   - Folder path (or click `Browse` for real folder picker)
4. Click `Create project`.
5. Select the project from the sidebar list before running tasks.
6. Run Cowork tasks as usual.

## Folder Picker Behavior

- Electron desktop mode: `Browse` opens native folder picker.
- Browser sandbox fallback: folder selection uses directory input fallback.

For reliable local file actions, use the Electron desktop app.

## Relationship To Safety and Approvals

Projects do not bypass safety policies.

- Project selects *where* actions run.
- Safety policy decides *whether* actions are allowed, blocked, or require approval.
- Approval queue still appears for configured risky scopes.

## Current Scope

Current project management supports:

- create project
- select active project
- persistent storage across restarts
- folder sync with working folder

Not yet included:

- rename project
- delete project
- project-level policy profiles
- project members/permissions

## Acceptance Criteria

### Functional Acceptance

- [ ] User can create and select a project from sidebar.
- [ ] Selecting a project updates Cowork working folder.
- [ ] Project selection persists across app restart.
- [ ] Editing working folder while project is active updates that project folder.
- [ ] Local actions cannot run outside selected project root without policy escalation.

### Safety Acceptance

- [ ] Approval cards include project context (title and path).
- [ ] Out-of-root path attempts are blocked or require approval.
- [ ] Safety scope checks still apply with projects enabled.

### Reliability Acceptance

- [ ] App recovers cleanly if active project was deleted or missing.
- [ ] If project folder becomes inaccessible, app communicates that state and prevents unsafe writes.

### E2E Acceptance (Recommended)

- [ ] `create project -> select project -> run action` succeeds.
- [ ] Switch project and verify new run uses new root folder.
- [ ] Change active project during existing run and verify run context does not change.
- [ ] Attempt write outside root and verify block/approval behavior.
- [ ] Restart app and verify active project restoration.

## Troubleshooting

If tasks seem to use the wrong folder:

1. Confirm active project in left sidebar.
2. Confirm working folder shown in Cowork right panel.
3. Re-select the intended project.
4. If needed, edit working folder (active project's folder will update).
