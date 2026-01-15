# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm run typecheck    # Type checking without emit
npm run lint         # ESLint on src/
npm test             # Run vitest in watch mode
npm run test:run     # Single test run
npm run test:coverage # Coverage report
```

Run a single test file:
```bash
npx vitest run test/analyzers/graphql.test.ts
```

Run tests matching a pattern:
```bash
npx vitest run -t "GraphQL"
```

## CLI Usage (Local Development)

After building, run the CLI directly:
```bash
node dist/cli.js analyze --base origin/main --head HEAD
node dist/cli.js init --format yaml
node dist/cli.js validate --config impact.config.yaml
node dist/cli.js enhance -i impact.json --v2 -c impact.config.yaml
```

Or via npm link:
```bash
npm link
impact analyze --base origin/main --head HEAD
```

## Architecture

### Entry Points
- `src/cli.ts` - CLI commands (analyze, enhance, validate, init)
- `src/index.ts` - Library exports for programmatic use

### Analyzer System
Pluggable analyzers implement `BaseAnalyzer` (src/analyzers/base.ts):

| Analyzer | Type | Purpose |
|----------|------|---------|
| `AngularAnalyzer` | ts-morph | Angular components/services/modules via TypeScript AST |
| `GraphQLAnalyzer` | graphql-inspector | Schema changes and breaking change detection |
| `GoAnalyzer` | go-ast | Go struct and function analysis |
| `CrossRepoAnalyzer` | - | Correlates impacts across repos via relations |

New analyzers extend `BaseAnalyzer` and implement:
- `analyze(): Promise<ImpactItem[]>` - Returns impact items
- `get name(): string` - Analyzer identifier

Base class provides: `getChangedFiles()`, `getFileDiff()`, `filterByExtension()`, `deduplicateImpacts()`, `createImpact()`

### LLM Enhancement
Two enhancement modes in `src/llm/`:
- `enhancer.ts` - Basic mode: generates test hints per impact
- `enhancer-v2.ts` - Enhanced mode (`--v2`): includes git diffs, risk levels, batching, executive summary

Uses Vercel AI SDK with provider abstraction:
- OpenAI (`OPENAI_API_KEY`)
- Anthropic (`ANTHROPIC_API_KEY`)
- Google (`GOOGLE_API_KEY`)

### Integrations
- `src/integrations/github.ts` - PR comments, check annotations
- `src/integrations/slack.ts` - Webhook notifications

### Configuration
- `src/config/schema.ts` - Zod schemas for validation
- `src/config/loader.ts` - YAML/JSON loading with env var substitution

Config files searched: `impact.config.yaml`, `impact.config.yml`, `impact.config.json`, `.impactrc.yaml`, `.impactrc.json`

## Key Types

Core types in `src/types/impact.ts`:
- `ImpactConfig` - Top-level config (repos, relations, output, llm)
- `RepoConfig` - Per-repo settings (name, path, type, analyzers)
- `ImpactItem` - Single impact with component, file, reasons, testHints
- `AnalysisResult` - Full output (meta, summary, repos, crossRepoImpacts)

## Testing Structure

Tests in `test/` mirror `src/` structure:
- `test/analyzers/` - Analyzer unit tests
- `test/config/` - Config loading/validation tests
- `test/llm/` - Secrets filter and enhancer tests
- `test/integrations/` - GitHub/Slack integration tests

Use vitest globals (no imports needed for `describe`, `it`, `expect`).

## Environment Variables

For LLM enhancement:
- `OPENAI_API_KEY` - OpenAI provider
- `ANTHROPIC_API_KEY` - Claude provider
- `GOOGLE_API_KEY` - Gemini provider

For integrations:
- `GITHUB_TOKEN` - GitHub API access
- `SLACK_WEBHOOK_URL` - Slack notifications
