# CueDesk Design Docs

This file is now the design index. Detailed docs are split for clarity and maintenance:

## Primary Docs
- [README](./README.md) - setup, usage, feature overview
- [Architecture](./docs/architecture.md) - runtime, data flow, domain boundaries
- [State Machine](./docs/state-machine.md) - effective status, billing truth, derivation rules
- [API Reference](./docs/api-reference.md) - route-by-route request/response contract

## Why This Split
- Easier onboarding for new developers
- Faster updates when business rules evolve
- Cleaner separation between product intent and implementation detail

## Non-Negotiable Principle
Single source of truth remains backend database + service logic.
UI must only display backend-derived state.
