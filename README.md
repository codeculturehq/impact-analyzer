# @codeculture/impact-analyzer

Cross-repo impact analysis tool for monorepo and multi-repo setups. Analyzes code changes between git refs and identifies impacted components across repositories.

## Features

- **Multi-repo support**: Analyze impacts across multiple repositories
- **Angular analysis**: Deep analysis using ts-morph for Angular components, services, modules
- **Configurable**: YAML/JSON configuration for repos, relations, and outputs
- **Multiple outputs**: JSON, Markdown, GitHub PR comments
- **Extensible**: Pluggable analyzer architecture

## Installation

```bash
npm install -g @codeculture/impact-analyzer
# or
npx @codeculture/impact-analyzer
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

## Supported Repository Types

- `angular` - Angular applications (components, services, modules)
- `react` - React applications (coming soon)
- `vue` - Vue applications (coming soon)
- `nextjs` - Next.js applications (coming soon)
- `graphql-node` - Node.js GraphQL APIs (coming soon)
- `go` - Go services (coming soon)
- `node` - Generic Node.js projects (coming soon)

## Supported Analyzers

- `ts-morph` - TypeScript AST analysis
- `nx` - Nx workspace affected analysis (coming soon)
- `madge` - Module dependency analysis (coming soon)
- `graphql-inspector` - GraphQL schema analysis (coming soon)
- `go-ast` - Go AST analysis (coming soon)

## Output Formats

### JSON

Complete analysis results in JSON format for programmatic use.

### Markdown

Human-readable report with summary tables and detailed impacts.

### GitHub

PR comment format with collapsible details, optimized for GitHub Actions.

## GitHub Actions Integration

```yaml
- name: Impact Analysis
  run: |
    npx @codeculture/impact-analyzer analyze \
      --base origin/${{ github.base_ref }} \
      --head HEAD \
      --format github \
      --output ./impact

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
```

## License

MIT
