# @lean-saas/ui

Shared UI components package for Lean SaaS Starter.

## Status

🚧 **Package Structure Created** - Components will be added as needed.

## Structure

```
packages/ui/
├── components/          # React components
│   └── index.ts        # Component exports
├── index.ts            # Main exports
├── index.d.ts          # Type definitions
├── package.json        # Package configuration
├── tsconfig.json       # TypeScript config
└── README.md           # This file
```

## Usage

```typescript
import { Button, Card, Modal } from '@lean-saas/ui';
```

## Development

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Future Components

This package will contain reusable React components such as:
- Button
- Card
- Modal
- Input
- Select
- Table
- etc.