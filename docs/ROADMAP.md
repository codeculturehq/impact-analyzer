# Impact Analyzer Roadmap

## Current Status: v0.1.0 (MVP)

### Completed
- [x] TypeScript project setup with ESM modules
- [x] Zod-based config schema and loader (YAML/JSON)
- [x] BaseAnalyzer abstract class
- [x] AngularAnalyzer with ts-morph AST analysis
- [x] CLI with analyze, validate, init commands
- [x] Output formats: JSON, Markdown, GitHub PR comment
- [x] Initial test suite

## Phase 1: Core Analyzers (v0.2.0)

### Analyzers
- [ ] **GraphQL Analyzer** - Schema breaking change detection with graphql-inspector
- [ ] **NX Analyzer** - Workspace affected detection using nx affected
- [ ] **Madge Analyzer** - Module dependency graph analysis
- [ ] **React Analyzer** - Component and hook analysis with ts-morph
- [ ] **Go Analyzer** - Go AST analysis for Lambda functions

### Infrastructure
- [ ] Cross-repo impact detection via relations config
- [ ] Improved error handling and logging
- [ ] Performance optimization for large repos

## Phase 2: LLM Integration (v0.3.0)

### Features
- [ ] `impact enhance` command for LLM analysis
- [ ] Claude CLI integration
- [ ] Codex CLI integration
- [ ] Gemini CLI integration
- [ ] Secrets filtering before LLM calls
- [ ] Test hints generation
- [ ] Risk assessment

### Configuration
- [ ] Per-repo LLM settings
- [ ] Custom prompts configuration
- [ ] Token limit management

## Phase 3: CI/CD Integration (v0.4.0)

### GitHub Actions
- [ ] Official GitHub Action
- [ ] PR comment automation
- [ ] GitHub Check annotations
- [ ] Status checks integration

### Outputs
- [ ] Slack webhook integration
- [ ] Custom webhook support
- [ ] HTML report generation

## Phase 4: Advanced Features (v0.5.0)

### Analysis
- [ ] Breaking change detection
- [ ] Test coverage correlation
- [ ] Historical impact tracking
- [ ] Dependency vulnerability scanning

### Developer Experience
- [ ] Watch mode for local development
- [ ] VS Code extension
- [ ] Interactive CLI mode

## Future Considerations

- Linear integration for automated ticket updates
- Jira integration
- Custom analyzer plugin system
- Web dashboard for impact visualization
- API endpoint for programmatic access
