/**
 * Core types for impact analysis
 */

// ============================================================================
// Config Types
// ============================================================================

export type RepoType = 'angular' | 'react' | 'vue' | 'nextjs' | 'graphql-node' | 'go' | 'node';
export type AnalyzerType = 'nx' | 'ts-morph' | 'madge' | 'graphql-inspector' | 'go-ast';
export type RelationType = 'graphql-schema' | 'sqs' | 'shared-types' | 'api-call' | 'npm-package';
export type LLMProvider = 'openai' | 'claude' | 'codex' | 'gemini' | 'github-models';

export interface RepoConfig {
  /** Repository name (used for identification) */
  name: string;
  /** Local path to the repository */
  path: string;
  /** Type of project */
  type: RepoType;
  /** Analyzers to run on this repo */
  analyzers: AnalyzerType[];
  /** Optional: specific paths to analyze within the repo */
  includePaths?: string[];
  /** Optional: paths to exclude from analysis */
  excludePaths?: string[];
}

export interface RelationConfig {
  /** Source repository name */
  from: string;
  /** Target repository name */
  to: string;
  /** Type of relation between repos */
  via: RelationType;
  /** Optional: specific file patterns that establish this relation */
  patterns?: string[];
}

export interface OutputConfig {
  /** Post comment to PR */
  githubComment: boolean;
  /** Create GitHub Check with annotations */
  githubCheck: boolean;
  /** Slack notification settings */
  slack?: {
    channel: string;
    webhook?: string;
  };
}

export interface LLMConfig {
  /** Enable LLM analysis */
  enabled: boolean;
  /** LLM provider to use */
  provider: LLMProvider;
  /** Model to use (provider-specific) */
  model?: string;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Enable secrets filtering before sending to LLM */
  secretsFilter: boolean;
}

export interface ImpactConfig {
  /** Repositories to analyze */
  repos: RepoConfig[];
  /** Relations between repositories */
  relations: RelationConfig[];
  /** Output configuration */
  output: OutputConfig;
  /** LLM configuration (optional) */
  llm?: LLMConfig;
}

// ============================================================================
// Analysis Result Types
// ============================================================================

export type ReasonType = 'direct' | 'dependency' | 'schema' | 'style' | 'config' | 'template' | 'module';

export interface Reason {
  /** Type of impact reason */
  type: ReasonType;
  /** Source that caused the impact (file, component, schema field, etc.) */
  source: string;
  /** Human-readable description */
  description: string;
}

export interface ImpactItem {
  /** Component/module name */
  component: string;
  /** Repository this component belongs to */
  repo: string;
  /** File path relative to repo root */
  file: string;
  /** Line number (if applicable) */
  line?: number;
  /** Reasons why this component is impacted */
  reasons: Reason[];
  /** Test hints from LLM (only when LLM is enabled) */
  testHints?: string[];
}

export interface CrossRepoImpact {
  /** Source repository name */
  sourceRepo: string;
  /** Source component/file that changed */
  sourceComponent: string;
  /** Target repository name */
  targetRepo: string;
  /** Components in target repo that are affected */
  targetComponents: string[];
  /** Type of relation that caused this cross-repo impact */
  relation: RelationType;
}

export interface RepoResult {
  /** Repository name */
  name: string;
  /** Number of changed files in this repo */
  changedFiles: number;
  /** Impact items for this repo */
  impacts: ImpactItem[];
  /** Errors encountered during analysis (non-fatal) */
  errors?: string[];
}

export interface Summary {
  /** Total number of changed files across all repos */
  totalChangedFiles: number;
  /** Total number of impacted components */
  totalImpactedComponents: number;
  /** Whether any breaking changes were detected */
  hasBreakingChanges: boolean;
  /** Per-repo summary */
  repos: { name: string; changedFiles: number; impactCount: number }[];
}

export interface AnalysisMeta {
  /** Timestamp of analysis */
  timestamp: string;
  /** Base git reference */
  baseRef: string;
  /** Head git reference */
  headRef: string;
  /** Tool name */
  tool: string;
  /** Tool version */
  version: string;
  /** PR URL (if applicable) */
  prUrl?: string;
}

export interface AnalysisResult {
  /** Metadata about this analysis */
  meta: AnalysisMeta;
  /** Summary statistics */
  summary: Summary;
  /** Per-repo results */
  repos: RepoResult[];
  /** Cross-repo impacts */
  crossRepoImpacts: CrossRepoImpact[];
}

// ============================================================================
// CLI Types
// ============================================================================

export interface AnalyzeOptions {
  /** Path to config file */
  config: string;
  /** Base git reference */
  base: string;
  /** Head git reference */
  head: string;
  /** Output directory */
  output: string;
  /** Output formats (comma-separated) */
  format: string;
}

export interface EnhanceOptions {
  /** Input JSON file from analyze step */
  input: string;
  /** Output file path */
  output: string;
  /** LLM provider */
  provider: LLMProvider;
}

// ============================================================================
// GitHub Types
// ============================================================================

export interface GitHubAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}
