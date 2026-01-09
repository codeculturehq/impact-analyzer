import { z } from 'zod';

// ============================================================================
// Zod Schemas for Config Validation
// ============================================================================

export const RepoTypeSchema = z.enum([
  'angular',
  'react',
  'vue',
  'nextjs',
  'graphql-node',
  'go',
  'node',
]);

export const AnalyzerTypeSchema = z.enum([
  'nx',
  'ts-morph',
  'madge',
  'graphql-inspector',
  'go-ast',
]);

export const RelationTypeSchema = z.enum([
  'graphql-schema',
  'sqs',
  'shared-types',
  'api-call',
  'npm-package',
]);

export const LLMProviderSchema = z.enum(['openai', 'claude', 'gemini']);

export const RepoConfigSchema = z.object({
  name: z.string().min(1, 'Repository name is required'),
  path: z.string().min(1, 'Repository path is required'),
  type: RepoTypeSchema,
  analyzers: z.array(AnalyzerTypeSchema).min(1, 'At least one analyzer is required'),
  includePaths: z.array(z.string()).optional(),
  excludePaths: z.array(z.string()).optional(),
});

export const RelationConfigSchema = z.object({
  from: z.string().min(1, 'Source repository is required'),
  to: z.string().min(1, 'Target repository is required'),
  via: RelationTypeSchema,
  patterns: z.array(z.string()).optional(),
});

export const OutputConfigSchema = z.object({
  githubComment: z.boolean().default(true),
  githubCheck: z.boolean().default(true),
  slack: z
    .object({
      channel: z.string().min(1),
      webhook: z.string().url().optional(),
    })
    .optional(),
});

export const LLMConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: LLMProviderSchema.default('openai'),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  secretsFilter: z.boolean().default(true),
});

export const ImpactConfigSchema = z
  .object({
    repos: z.array(RepoConfigSchema).min(1, 'At least one repository is required'),
    relations: z.array(RelationConfigSchema).default([]),
    output: OutputConfigSchema.default({
      githubComment: true,
      githubCheck: true,
    }),
    llm: LLMConfigSchema.optional(),
  })
  .refine(
    (config) => {
      // Validate that all relation references exist in repos
      const repoNames = new Set(config.repos.map((r) => r.name));
      for (const relation of config.relations) {
        if (!repoNames.has(relation.from)) {
          return false;
        }
        if (!repoNames.has(relation.to)) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'All relation references must point to defined repositories',
    }
  );

export type ValidatedImpactConfig = z.infer<typeof ImpactConfigSchema>;

/**
 * Helper function for defining impact config with type safety
 */
export function defineConfig(config: ValidatedImpactConfig): ValidatedImpactConfig {
  return ImpactConfigSchema.parse(config);
}
