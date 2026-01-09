# Cross-Repo Impact Analyzer - Design Document

**Datum:** 2025-01-09
**Status:** Approved
**Linear Ticket:** AI-18

## Übersicht

Automatisierte Impact-Analyse für Multi-Repo-Setups, die bei PRs und Releases erkennt, welche Komponenten durch Code-Änderungen betroffen sind – auch repo-übergreifend.

## Entscheidungen

| Aspekt | Entscheidung |
|--------|--------------|
| Repos | Multi-Repo (Frontend, API, Lambdas) |
| Trigger | PR→develop (ohne LLM), develop→staging/master (mit LLM) |
| Architektur | Ein GitHub Action Job, checkt alle Repos aus |
| Output | PR-Kommentar + GitHub Check + Slack |
| LLM | Claude/Codex/Gemini CLI, kein n8n |
| Secrets | Basis-Filter (.env, API-Keys maskieren) |
| Implementierung | TypeScript + bestehende Tools |
| Paket-Name | `@codeculture/impact-analyzer` (generisch, nicht projekt-spezifisch) |

---

## 1. Architektur

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │ Frontend PR │    │   API PR    │    │ Lambdas PR  │                 │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                 │
│         │                  │                  │                         │
│         └──────────────────┼──────────────────┘                         │
│                            ▼                                            │
│              ┌─────────────────────────┐                               │
│              │   impact-analyzer.yml   │                               │
│              │   (Shared Workflow)     │                               │
│              └────────────┬────────────┘                               │
│                           │                                            │
│         ┌─────────────────┼─────────────────┐                          │
│         ▼                 ▼                 ▼                          │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐                     │
│  │ checkout   │   │ checkout   │   │ checkout   │                     │
│  │ frontend   │   │ api        │   │ lambdas    │                     │
│  └────────────┘   └────────────┘   └────────────┘                     │
│         │                 │                 │                          │
│         └─────────────────┼─────────────────┘                          │
│                           ▼                                            │
│              ┌─────────────────────────┐                               │
│              │  @codeculture/impact-cli│                               │
│              │  (TypeScript Tool)      │                               │
│              └────────────┬────────────┘                               │
│                           │                                            │
│         ┌────────────┬────┴────┬────────────┐                          │
│         ▼            ▼         ▼            ▼                          │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│   │ nx       │ │ graphql- │ │ madge    │ │ go/ast   │                 │
│   │ affected │ │inspector │ │          │ │ (exec)   │                 │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘                 │
│                           │                                            │
│                           ▼                                            │
│              ┌─────────────────────────┐                               │
│              │    Aggregated Impact    │                               │
│              │    (JSON + Markdown)    │                               │
│              └────────────┬────────────┘                               │
│                           │                                            │
│         ┌─────────────────┼─────────────────┐                          │
│         ▼                 ▼                 ▼                          │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐                      │
│   │ PR       │     │ GitHub   │     │ Slack    │                      │
│   │ Comment  │     │ Check    │     │ Message  │                      │
│   └──────────┘     └──────────┘     └──────────┘                      │
│                                                                         │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Nur bei develop→staging / staging→master:                             │
│                           │                                            │
│                           ▼                                            │
│              ┌─────────────────────────┐                               │
│              │  LLM CLI (Claude/Codex) │                               │
│              │  + Secrets Filter       │                               │
│              └────────────┬────────────┘                               │
│                           ▼                                            │
│              ┌─────────────────────────┐                               │
│              │  Testhinweise pro       │                               │
│              │  Komponente             │                               │
│              └─────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Kernprinzipien:**
- **Ein Workflow, alle Repos** – Shared Workflow wird von jedem Repo aufgerufen
- **Tool-Komposition** – Spezialisierte Tools für jede Analyse-Art
- **Zwei Modi** – Schnell (PR) vs. Tiefenanalyse (Release)

---

## 2. Tool-Stack & Dependencies

### NPM Package

```json
{
  "name": "@codeculture/impact-analyzer",
  "version": "1.0.0",
  "bin": {
    "impact": "./dist/cli.js"
  },
  "dependencies": {
    "nx": "^19.x",
    "@graphql-inspector/core": "^5.x",
    "madge": "^8.x",
    "ts-morph": "^23.x",
    "@octokit/rest": "^21.x",
    "@slack/web-api": "^7.x",
    "glob": "^11.x",
    "chalk": "^5.x",
    "commander": "^12.x",
    "zod": "^3.x",
    "execa": "^9.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vitest": "^2.x",
    "@types/node": "^22.x"
  }
}
```

### Tool-Zuordnung

| Repo-Typ | Tool | Erkennt |
|----------|------|---------|
| Angular | `nx affected` + `ts-morph` | Components, Services, Pipes |
| GraphQL API | `graphql-inspector` | Breaking Changes, neue Fields |
| Go Lambdas | `go/ast` via `execa` | Handler, SQS-Consumer |
| Alle | `madge` | Import-Graph, Circular Deps |
| Alle | `git diff` | Changed Files |

### Externe CLIs (Runtime)

```bash
go        # Für Go-AST Analyse
claude    # LLM CLI (optional, nur Release)
```

---

## 3. Konfiguration

### impact.config.yaml

```yaml
repos:
  - name: frontend
    path: ./repos/frontend
    type: angular
    analyzers: [nx, ts-morph, madge]

  - name: api
    path: ./repos/api
    type: graphql-node
    analyzers: [graphql-inspector]

  - name: lambdas
    path: ./repos/lambdas
    type: go
    analyzers: [go-ast]

relations:
  - from: api
    to: frontend
    via: graphql-schema

  - from: lambdas
    to: api
    via: sqs

output:
  github-comment: true
  github-check: true
  slack:
    channel: "#deployments"

llm:
  enabled: false
  provider: claude
  secrets-filter: true
```

---

## 4. GitHub Actions Workflow

### Shared Workflow (codeculture/github-workflows)

```yaml
name: Cross-Repo Impact Analysis

on:
  workflow_call:
    inputs:
      config-path:
        required: false
        default: './impact.config.yaml'
      enable-llm:
        required: false
        default: false
        type: boolean
      base-ref:
        required: false
        default: ''
      head-ref:
        required: false
        default: ''
    secrets:
      GH_PAT:
        required: true
      SLACK_WEBHOOK:
        required: false
      LLM_API_KEY:
        required: false

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write

    steps:
      - name: Checkout current repo
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Load config
        id: config
        run: |
          REPOS=$(yq -r '.repos[].name' ${{ inputs.config-path }} | tr '\n' ' ')
          echo "repos=$REPOS" >> $GITHUB_OUTPUT

      - name: Checkout dependent repos
        uses: actions/checkout@v4
        with:
          repository: ${{ github.repository_owner }}/${{ matrix.repo }}
          path: ./repos/${{ matrix.repo }}
          token: ${{ secrets.GH_PAT }}
        strategy:
          matrix:
            repo: ${{ fromJson(steps.config.outputs.repos) }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Install impact-analyzer
        run: npm install -g @codeculture/impact-analyzer

      - name: Run deterministic analysis
        id: analysis
        run: |
          impact analyze \
            --config ${{ inputs.config-path }} \
            --base ${{ inputs.base-ref || github.event.pull_request.base.sha }} \
            --head ${{ inputs.head-ref || github.sha }} \
            --output ./impact-results \
            --format json,markdown

      - name: Run LLM analysis
        if: inputs.enable-llm == true
        env:
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
        run: |
          impact enhance \
            --input ./impact-results/impact.json \
            --output ./impact-results/impact-enhanced.json \
            --provider ${{ env.LLM_PROVIDER || 'claude' }}

      - name: Post PR Comment
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        # ... (siehe vollständige Implementation)

      - name: Create GitHub Check
        uses: actions/github-script@v7
        # ... (siehe vollständige Implementation)

      - name: Send Slack notification
        if: secrets.SLACK_WEBHOOK != ''
        uses: slackapi/slack-github-action@v1
        # ... (siehe vollständige Implementation)
```

### Aufruf aus Projekt-Repo

**PR Workflow:**

```yaml
# sanacorp-frontend/.github/workflows/pr.yml
name: PR Checks

on:
  pull_request:
    branches: [develop]

jobs:
  impact:
    uses: codeculture/github-workflows/.github/workflows/impact-analyzer.yml@main
    with:
      enable-llm: false
    secrets:
      GH_PAT: ${{ secrets.GH_PAT }}
      SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
```

**Release Workflow:**

```yaml
# sanacorp-frontend/.github/workflows/release.yml
name: Release to Staging

on:
  push:
    branches: [staging]

jobs:
  impact:
    uses: codeculture/github-workflows/.github/workflows/impact-analyzer.yml@main
    with:
      enable-llm: true
      base-ref: develop
      head-ref: staging
    secrets:
      GH_PAT: ${{ secrets.GH_PAT }}
      SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
      LLM_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Trigger-Matrix

| Event | Branch | LLM | Output |
|-------|--------|-----|--------|
| PR opened/updated | → develop | ❌ | PR Comment, Check |
| Push | → staging | ✅ | PR Comment, Check, Slack |
| Push | → master | ✅ | PR Comment, Check, Slack |

---

## 5. TypeScript Analyzer Struktur

### Projektstruktur

```
@codeculture/impact-analyzer/
├── src/
│   ├── cli.ts
│   ├── config/
│   │   ├── schema.ts
│   │   └── loader.ts
│   ├── analyzers/
│   │   ├── base.ts
│   │   ├── angular.analyzer.ts
│   │   ├── graphql.analyzer.ts
│   │   ├── go.analyzer.ts
│   │   └── node.analyzer.ts
│   ├── aggregator/
│   │   ├── cross-repo.ts
│   │   └── relations.ts
│   ├── filters/
│   │   └── secrets.filter.ts
│   ├── llm/
│   │   ├── provider.ts
│   │   ├── claude.provider.ts
│   │   ├── codex.provider.ts
│   │   └── prompts.ts
│   ├── output/
│   │   ├── github-comment.ts
│   │   ├── github-check.ts
│   │   ├── slack.ts
│   │   ├── json.ts
│   │   └── markdown.ts
│   └── types/
│       └── impact.ts
├── test/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Core Types

```typescript
export interface ImpactConfig {
  repos: RepoConfig[];
  relations: RelationConfig[];
  output: OutputConfig;
  llm?: LLMConfig;
}

export interface ImpactItem {
  component: string;
  repo: string;
  file: string;
  reasons: Reason[];
  testHints?: string[];
}

export interface Reason {
  type: 'direct' | 'dependency' | 'schema' | 'style' | 'config';
  source: string;
  description: string;
}

export interface CrossRepoImpact {
  sourceRepo: string;
  sourceComponent: string;
  targetRepo: string;
  targetComponents: string[];
  relation: 'graphql-schema' | 'sqs' | 'shared-types' | 'api-call';
}
```

### CLI Interface

```bash
# Deterministische Analyse
impact analyze \
  --config ./impact.config.yaml \
  --base origin/develop \
  --head HEAD \
  --output ./results \
  --format json,markdown

# LLM Enhancement
impact enhance \
  --input ./results/impact.json \
  --output ./results/impact-enhanced.json \
  --provider claude
```

---

## 6. LLM-Integration

### Provider Pattern

```typescript
export interface LLMProvider {
  name: string;
  generateTestHints(component: ImpactItem): Promise<string[]>;
}
```

### Secrets Filter

Maskiert vor dem LLM-Call:
- API Keys (`api_key`, `apikey`, etc.)
- AWS Credentials (`AKIA...`, `aws_secret`)
- Tokens (`token`, `bearer`, `auth`)
- Passwords (`password`, `passwd`, `pwd`)
- Connection Strings (`mongodb://`, `postgres://`)
- .env Werte
- Private Keys

### Prompts

```typescript
// Test-Hinweis Generierung
`Du bist ein QA-Assistent für Angular-Anwendungen.
Erstelle 3-8 konkrete Prüfpunkte für manuelle UI-Tests.
Fokussiere auf die AUSWIRKUNGEN der Änderungen.`
```

---

## 7. Output-Formate

### JSON (maschinenlesbar)

```json
{
  "meta": { "timestamp": "...", "baseRef": "...", "headRef": "..." },
  "summary": {
    "totalChangedFiles": 12,
    "totalImpactedComponents": 8,
    "hasBreakingChanges": true
  },
  "impacts": [...],
  "crossRepoImpacts": [...],
  "testHints": [...]
}
```

### Markdown (PR-Kommentar)

```markdown
## 🔴 Impact Analysis

| Metrik | Wert |
|--------|------|
| Geänderte Dateien | 12 |
| Betroffene Komponenten | 8 |

### 🔗 Cross-Repo Abhängigkeiten
- **api** → **frontend** (via graphql-schema)

### 📁 frontend
<details>
<summary>6 betroffene Komponenten</summary>
...
</details>
```

### GitHub Check Annotations

- Breaking Changes als Warnings
- Cross-Repo Impacts als Notices

### Slack Message

- Status-Header mit Emoji
- Summary-Fields
- Cross-Repo Warnings
- Link zum PR

---

## Nächste Schritte

1. [ ] Repository `@codeculture/impact-analyzer` erstellen
2. [ ] TypeScript Projekt-Setup
3. [ ] Base Analyzer + Angular Analyzer implementieren
4. [ ] GitHub Actions Shared Workflow erstellen
5. [ ] Sanacorp als erster Pilot

---

*Design erstellt durch Brainstorming-Session mit Claude Code*
