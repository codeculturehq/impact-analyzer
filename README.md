# @codeculturehq/impact-analyzer

Cross-repo impact analysis tool for monorepo and multi-repo setups. Analyzes code changes between git refs and identifies impacted components across repositories.

## Features

- **Multi-repo support**: Analyze impacts across multiple repositories
- **Angular analysis**: Deep analysis using ts-morph for Angular components, services, modules
- **GraphQL analysis**: Schema and query impact detection with graphql-inspector
- **LLM Enhancement**: AI-powered test suggestions using OpenAI, Claude, or Gemini
- **Configurable**: YAML/JSON configuration for repos, relations, and outputs
- **Multiple outputs**: JSON, Markdown, GitHub PR comments
- **Extensible**: Pluggable analyzer architecture

## Installation

```bash
npm install -g @codeculturehq/impact-analyzer
# or
npx @codeculturehq/impact-analyzer
```

## Quick Start

1. Initialize a config file:

```bash
impact init
```

2. Edit `impact.config.yaml` to match your project structure

3. Run analysis:

```bash
impact analyze --base origin/develop --head HEAD
```

4. (Optional) Enhance with AI-generated test suggestions:

```bash
impact enhance -i ./impact-output/impact.json -o ./impact-output/enhanced.json
```

## Configuration

Example `impact.config.yaml`:

```yaml
repos:
  - name: frontend
    path: ./frontend
    type: angular
    analyzers:
      - ts-morph

  - name: api
    path: ./api
    type: graphql-node
    analyzers:
      - graphql-inspector

relations:
  - from: frontend
    to: api
    via: graphql-schema

output:
  githubComment: true
  githubCheck: true

# Optional: LLM enhancement settings
llm:
  enabled: true
  provider: openai
  model: gpt-5.1-codex
  secretsFilter: true
```

## CLI Commands

### `impact analyze`

Run impact analysis between two git refs.

```bash
impact analyze [options]

Options:
  -c, --config <path>   Path to config file
  -b, --base <ref>      Base git reference (default: origin/develop)
  -h, --head <ref>      Head git reference (default: HEAD)
  -o, --output <dir>    Output directory (default: ./impact-output)
  -f, --format <list>   Output formats: json,markdown,github (default: json,markdown)
```

### `impact enhance`

Enhance impact analysis with AI-generated test suggestions.

```bash
impact enhance [options]

Options:
  -i, --input <file>       Input JSON file from analyze step (required)
  -o, --output <file>      Output file path (default: ./impact-output/enhanced.json)
  -p, --provider <name>    LLM provider: openai, claude, gemini (default: openai)
  -m, --model <name>       Model name (e.g., gpt-5.1-codex, claude-sonnet-4-20250514)
  --no-secrets-filter      Disable secrets filtering
  --v2                     Use enhanced v2 analysis (recommended)
  -c, --config <path>      Path to config file (required for --v2 diff extraction)
```

#### Enhanced v2 Mode

The `--v2` flag enables enhanced analysis with:
- **Git diff context**: Includes actual code changes for more accurate suggestions
- **Risk levels**: Categorizes impacts as high/medium/low risk
- **Review focus**: Highlights specific areas for code reviewers
- **Executive summary**: Generates an overview of all changes
- **Batched processing**: Groups related impacts for efficiency

```bash
# Recommended usage with v2
impact enhance -i impact.json --v2 -c impact.config.yaml
```

### `impact validate`

Validate a config file.

```bash
impact validate --config impact.config.yaml
```

### `impact init`

Create a new config file.

```bash
impact init --format yaml
```

## LLM Enhancement

The `enhance` command uses AI to analyze each impacted component and suggest specific test cases. Powered by [Vercel AI SDK](https://ai-sdk.dev/).

### Supported Providers

| Provider | Model Default | Environment Variable |
|----------|---------------|---------------------|
| `openai` | `gpt-5.1-codex` | `OPENAI_API_KEY` |
| `claude` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| `gemini` | `gemini-2.0-flash` | `GOOGLE_API_KEY` |

### Example Usage

```bash
# Using OpenAI (default)
export OPENAI_API_KEY="sk-..."
impact enhance -i impact.json

# Using Claude
export ANTHROPIC_API_KEY="sk-ant-..."
impact enhance -i impact.json --provider claude

# Using Gemini
export GOOGLE_API_KEY="..."
impact enhance -i impact.json --provider gemini

# Using a specific model
impact enhance -i impact.json --provider openai --model gpt-4o
```

### Output Format

The enhanced JSON includes `testHints` for each impacted component:

```json
{
  "repos": [{
    "name": "frontend",
    "impacts": [{
      "component": "UserProfileComponent",
      "file": "src/components/user-profile.ts",
      "testHints": [
        "Unit test: Verify component handles modified schema field correctly",
        "Integration test: Test GraphQL query with updated schema",
        "Edge case test: Handle null values for modified field"
      ]
    }]
  }],
  "enhanced": true,
  "llmProvider": "openai"
}
```

#### v2 Output Format

When using `--v2`, the output includes additional fields:

```json
{
  "repos": [{
    "name": "frontend",
    "impacts": [{
      "component": "UserProfileComponent",
      "file": "src/components/user-profile.ts",
      "testHints": [
        "Verify null handling for orderType field",
        "Test document mapping with undefined values"
      ],
      "riskLevel": "medium",
      "reviewFocus": [
        "Ensure null checks are correctly implemented"
      ],
      "affectedFlows": [
        "User profile editing flow"
      ]
    }]
  }],
  "enhanced": true,
  "llmProvider": "openai",
  "executiveSummary": "This update affects 37 components across frontend and API..."
}
```

### Rate Limiting

The enhance command includes built-in rate limiting to avoid API limits:
- Default: 3 concurrent requests with 100ms delay between calls
- Automatically retries failed requests

## Supported Repository Types

- `angular` - Angular applications (components, services, modules)
- `react` - React applications (coming soon)
- `vue` - Vue applications (coming soon)
- `nextjs` - Next.js applications (coming soon)
- `graphql-node` - Node.js GraphQL APIs
- `go` - Go services
- `node` - Generic Node.js projects (coming soon)

## Supported Analyzers

- `ts-morph` - TypeScript AST analysis
- `graphql-inspector` - GraphQL schema and query analysis
- `go-ast` - Go AST analysis
- `nx` - Nx workspace affected analysis (coming soon)
- `madge` - Module dependency analysis (coming soon)

## Output Formats

### JSON

Complete analysis results in JSON format for programmatic use.

### Markdown

Human-readable report with summary tables and detailed impacts.

### GitHub

PR comment format with collapsible details, optimized for GitHub Actions.

## GitHub Actions Integration

```yaml
name: Impact Analysis

on:
  pull_request:
    branches: [main, develop]

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Impact Analyzer
        run: npm install -g @codeculturehq/impact-analyzer

      - name: Run Impact Analysis
        run: |
          impact analyze \
            --base origin/${{ github.base_ref }} \
            --head HEAD \
            --format json,github \
            --output ./impact

      - name: Enhance with AI (optional)
        if: env.OPENAI_API_KEY
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          impact enhance \
            -i ./impact/impact.json \
            -o ./impact/enhanced.json

      - name: Post PR Comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const comment = fs.readFileSync('./impact/github-comment.md', 'utf8');
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: comment
            });
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Type check
npm run typecheck
```

## License

MIT
