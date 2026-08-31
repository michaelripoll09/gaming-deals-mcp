# Gaming Deals MCP

Local-first, self-hosted gaming purchase intelligence exposed through MCP, a local dashboard, a CLI, and a persistent scheduler.

Gaming Deals MCP is designed to compare real game offers across PC, PlayStation, Xbox, and Nintendo while understanding more than raw price: region compatibility, edition, platform, ownership, subscription access, wishlist priority, historical pricing, store trust, budget, physical vs. digital format, and personal buying preferences.

## Project status

Architecture approved. Implementation has not started yet.

The complete product and architecture specification lives in:

`docs/superpowers/specs/2026-08-30-gaming-deals-mcp-design.md`

## Planned capabilities

- Authorized retailers and marketplaces, clearly separated by source type and trust.
- PC, PlayStation, Xbox, and Nintendo from the first release.
- Digital storefront purchases, activation keys, physical new, physical used, and subscription access.
- Canonical game/release/edition/product matching instead of loose title matching.
- Region-aware offer validation and preferred-currency normalization.
- Wishlist, target prices, price history, historical lows, and buying alerts.
- Explainable personalized `dealScore` recommendations.
- Local budgets, purchase history, and spending-aware recommendations.
- Modular notification channels such as dashboard, Discord, Telegram, email, and local notifications.
- Persistent task runner and configurable local scheduler.
- Optional MCP-to-MCP integration with `steam-library-mcp` without sharing databases.
- React + Vite local dashboard bound to loopback only.

## Planned stack

- Node.js 22+
- TypeScript
- Model Context Protocol SDK
- SQLite
- React 19
- Vite
- Zod
- Vitest

## Product boundary

Gaming Deals MCP may compare offers, recommend where to buy, and direct the user to the selected offer. It will not store payment-card data, store storefront passwords, place orders automatically, or complete checkout on the user's behalf.

## Development

The repository is currently in the design phase. The next step, after reviewing and approving the specification, is to create the implementation plan and then build the project incrementally with tests.
