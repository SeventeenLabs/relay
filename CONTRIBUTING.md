# Contributing to Relay

Thanks for helping improve Relay.

## Development Setup

1. Install Node.js 20+ and npm 10+.
2. Install dependencies:
   - `npm install`
3. Start the desktop app in development mode:
   - `npm run dev`

## Quality Checks

Before opening a pull request, run:

- `npm run lint`
- `npm run typecheck`
- `npm run verify`

If your change touches UI behavior or workflows, also run E2E tests:

- `npm run test:e2e`

## Pull Request Guidelines

- Keep changes focused and minimal.
- Add or update tests for behavioral changes.
- Update docs when behavior, setup, or UX flows change.
- Use clear commit messages and PR descriptions.

## Reporting Bugs and Requesting Features

- Open a GitHub issue with steps to reproduce, expected behavior, and actual behavior.
- Include logs/screenshots when relevant.

## Code of Conduct

This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
By participating, you agree to uphold it.
