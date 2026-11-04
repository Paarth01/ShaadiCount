# Coding Agent Handoff Checklist

Before handing this ZIP to a coding agent, verify:
- [ ] ZIP contains `CODING_AGENT_INSTRUCTIONS.md` and `docs/project/implementation-contract.md`.
- [ ] Web-first decision is consistent in README, ADR-002, roadmap and UX documents.
- [ ] OpenAPI and SQL are clearly labelled as starter artifacts until reconciled.
- [ ] The coding agent has access to an actual repository/workspace where it can create source files and run commands.
- [ ] No secrets, customer data or provider credentials are included.
- [ ] The agent is asked to make changes in small phases and report file paths, test commands and outcomes.
- [ ] Human owner is available to resolve legal/provider/account decisions; the agent must not fabricate approvals.
- [ ] First deliverable requested is a repository audit and phased implementation plan, followed by foundation setup—not an unreviewed giant code dump.

## Suggested first task
"Read `CODING_AGENT_INSTRUCTIONS.md` and all referenced specs. Audit consistency, list concrete contradictions/blockers, then create the local development foundation (web app, API, PostgreSQL migrations, test setup, CI, `.env.example`, Docker Compose). Do not enable live messaging or implement billing. Run all checks and report actual outcomes. Do not proceed to feature phases until the foundation is reviewed."
