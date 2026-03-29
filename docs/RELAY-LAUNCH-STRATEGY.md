# Relay Launch Strategy

> Created: March 24, 2026

---

## The Category Phrase: "Human-Approved AI"

### Why this phrase

| Criterion | Score |
|---|---|
| Counter-narrative to Paperclip's "zero-human companies" | Explicit inversion |
| Category binary â€” forces every competitor to answer "is your AI human-approved?" | Yes |
| Enterprise trust signal â€” procurement, compliance, legal love it | Yes |
| Brevity (3 words, no explanation needed) | Yes |
| Works at every level: tagline, tweet, slide header, sales pitch, category label | Yes |
| Matches product page metrics â€” 94% approval rate, audit readiness 100% | Yes |

### How to use it

- **Category label:** "Human-Approved AI" â€” the movement/category you own
- **Page hero (keep existing):** "Delegate Real Work. Keep Human Control."
- **Full tagline:** "Relay â€” Human-Approved AI for Business Operations"
- **Shorthand for tweets/bio:** "Building human-approved AI"

### Runner-up phrases (available for secondary use)

| Phrase | Best for | Weakness |
|---|---|---|
| Approval-First AI | Technical/builder audiences, follows "[x]-first" convention | Colder, less emotional |
| AI That Reports to You | Non-technical audiences, immediately relatable | Slightly informal for enterprise |
| The Operated Company | Category-creating archetype, contrasts "zero-human companies" | Requires explanation |
| Governed Execution | Corporate/enterprise, already on product page | Safe, not provocative enough for organic sharing |

---

## Part 1: Pre-Launch Foundation (Weeks 1-4)

### A. Finish the product loop

The codebase has a working chat + cowork flow, but MVP-defining features are incomplete. Before any public launch, these must work end-to-end:

| Must-work | Status now | Must-ship state |
|---|---|---|
| Dispatch (assign & walk away) | Missing | Task dispatched â†’ agent works â†’ notification â†’ review â†’ approve |
| Approval gates | UI only, not enforced | Gateway-enforced: no action executes without operator approval on gated scopes |
| Memory injection | localStorage, not injected into prompts | Operator context injected into every agent prompt |
| Activity/audit trail | Working | Every dispatched task traceable with full tool-call history |

**Rule:** Don't launch until someone can dispatch a task, close the laptop, get a notification, review the result, and approve it. That's the demo that proves Relay exists.

### B. Fix the homepage

The seventeenlabs.io homepage is throwing a client-side exception. Fix it before anything else. Every visitor who hits a broken homepage is a permanent loss.

### C. Record the demo video

Film a single 90-second screen recording showing the dispatch-approve loop:

1. User types a task ("Plan next quarter's content calendar for our agency")
2. Clicks "Dispatch"
3. App minimizes / user opens another app
4. Notification pops: "Task complete â€” review ready"
5. User opens Relay, sees the result
6. Clicks "Approve" â€” done

This video becomes the centerpiece of every channel (Twitter/X, GitHub README, Reddit, blog post, Product Hunt).

---

## Part 2: Audience Pre-Heating (Weeks 2-5, overlaps with build)

### D. Category narrative on Twitter/X

Current: 469 followers, content already performs well (7K+ views on some posts). Shift from general marketing advice to **"Human-Approved AI" narrative content**:

- **Week 1-2:** Philosophy posts.
  - "Everyone's racing to remove humans from the loop. I'm building the opposite."
  - "The problem isn't that AI can't work autonomously. It's that no one's accountable when it does."
  - "Zero-human companies sound impressive until the first unreviewed action costs you a client."
- **Week 3-4:** Build-in-public posts.
  - Show the dispatch flow working.
  - Show the approval gate stopping a bad action.
  - Show the audit trail.
  - Screenshots + short video clips.
- **Post cadence:** 1 narrative post/day + 2-3 replies to AI agent discourse.
- **Thread formula:** "Why I'm building human-approved AI (thread)" â€” tell the story of why you started SeventeenLabs, what you saw in the market, and why governance matters.

### E. Seed the subreddits

Target channels (post DURING launch week, not before):

- **r/SideProject** â€” "I built an open-source AI operator desk with human approval gates"
- **r/selfhosted** â€” "Self-hosted AI operator with local-first architecture and governance controls"
- **r/artificial** â€” "Everyone's building autonomous AI. I'm building the opposite â€” human-approved AI"
- **r/startups** â€” "After building AI automation for 40+ agencies, I learned teams don't want autonomous AI. They want accountable AI."

---

## Part 3: Launch Execution (Week 5-6)

### F. GitHub launch

1. **README rewrite** â€” Structure: Hero (one-line + 90-sec video) â†’ "What is Relay?" (3 bullets) â†’ Screenshots â†’ Quick Start â†’ Architecture â†’ Comparison table vs. Cowork / Paperclip â†’ Contributing
2. **Star the category** â€” Topic tags: `ai-operator`, `human-approved-ai`, `governed-ai`, `electron`, `local-first`
3. **License** â€” Add MIT LICENSE file (currently missing from the repo)
4. **Release binary** â€” Set up GitHub Releases with the binary + changelog (Relay Setup 0.1.0.exe already exists in release/)

### G. Launch day sequence

| Time | Action | Channel |
|---|---|---|
| 09:00 | Push final README + release binary to GitHub | GitHub |
| 09:15 | Tweet: category-defining thread (5-7 tweets) with video | Twitter/X |
| 09:30 | Post on r/SideProject | Reddit |
| 10:00 | Post on r/selfhosted | Reddit |
| 10:30 | Reply to every comment immediately for 2 hours | Reddit + Twitter |
| 12:00 | Post on r/artificial | Reddit |
| 14:00 | Submit to Hacker News ("Show HN: Relay â€” human-approved AI operator desk") | HN |
| 14:00+ | Post on LinkedIn with video | LinkedIn |
| All day | Respond to EVERY star, comment, reply, and DM | All |

### H. The launch tweet thread structure

1. **Hook:** "Everyone's racing to build AI that works without humans. I spent 2 years building the opposite."
2. **Problem:** "Autonomous agents are impressive demos. But in production, one unreviewed action can torpedo a client relationship."
3. **Category:** "That's why I built Relay â€” human-approved AI for business operations."
4. **Video:** The 90-second dispatch-approve demo
5. **Differentiator:** "Self-hosted. Model-agnostic. Every action traceable. Nothing executes without your approval."
6. **Open source:** "Relay is free and open source. MIT licensed."
7. **CTA:** GitHub link + "Star if you believe AI should be human-approved"

---

## Part 4: Post-Launch Compounding (Weeks 6-12)

### I. Content flywheel

| Week | Content | Purpose |
|---|---|---|
| 6 | "Why approval gates beat autonomous agents for agency operations" (blog) | SEO + thought leadership |
| 7 | "Relay vs Cowork vs Paperclip" comparison post (blog + Reddit) | Capture comparison traffic |
| 8 | Video: "Setting up Relay for your agency in 5 minutes" | YouTube + Twitter |
| 9 | "How I got X stars in Y days" (build-in-public post) | Meta-narrative, attracts builders |
| 10 | Launch on Product Hunt | New audience, badges for social proof |
| 11 | Guest post or podcast appearance on AI/ops podcast | Authority building |
| 12 | "Human-Approved AI Manifesto" â€” published essay on what governed AI means | Category ownership |

### J. Community building

- Open a Discord from day one (link in README + product page)
- Respond to every GitHub issue within 4 hours
- Feature community contributions publicly (RT, mention in changelog)
- Create "Show your setup" channel â€” users share how they configured Relay for their business

### K. Monetization sequence

Don't monetize on launch day. Follow this sequence:

1. **Month 1-2:** Pure open source. Earn trust. Get stars. Get users.
2. **Month 3:** Introduce "Relay Pro" waitlist â€” hosted version with team features, SSO, and SLA
3. **Month 4:** Open Relay Pro at â‚¬49-99/mo per operator seat
4. **Month 6+:** Introduce Core platform pricing for larger teams (â‚¬200-2,000/mo)

---

## Part 5: Risk Mitigation

| Risk | Mitigation |
|---|---|
| Product isn't ready | Don't launch until dispatch-approve loop works end-to-end. Broken demo = permanent reputation damage |
| Low initial traction | Have 2 weeks of daily content queued. Traction compounds, not spikes |
| Cowork copies governance features | Move fast. Category ownership goes to whoever names and occupies it first |
| Paperclip absorbs your positioning | You're OPPOSITE to Paperclip. They want zero-human. You want human-approved. Don't compete â€” contrast |
| Homepage is broken | Fix this BEFORE anything else |
| "Just another AI wrapper" criticism | Counter: show the approval gate, the audit trail, the governance layer. Those aren't wrapper features |
| GitHub stars don't convert to users | Stars are awareness. Conversion comes from the hosted product (Relay Pro). Keep both funnels active |

---

## Summary: The 3 Things That Matter

1. **The phrase:** "Human-Approved AI" â€” own the category, create the debate
2. **The demo:** 90-second dispatch â†’ approve loop â€” prove it works
3. **The sequence:** Build in public â†’ launch on all channels same day â†’ compound with content

Everything else is execution detail. Get these three right and the rest follows.

