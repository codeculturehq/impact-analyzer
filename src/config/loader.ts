import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ImpactConfigSchema, type ValidatedImpactConfig } from './schema.js';
import type { ImpactConfig } from '../types/index.js';

export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = 'ConfigLoadError';
    this.cause = originalCause;
  }
}

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Load and validate an impact analyzer config file
 */
export async function loadConfig(configPath: string): Promise<ValidatedImpactConfig> {
  // Check if file exists
  if (!existsSync(configPath)) {
    throw new ConfigLoadError(`Config file not found: ${configPath}`, configPath);
  }

  // Read file contents
  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch (error) {
    throw new ConfigLoadError(`Failed to read config file: ${configPath}`, configPath, error);
  }

  // Parse based on file extension
  let rawConfig: unknown;
  const isYaml = configPath.endsWith('.yaml') || configPath.endsWith('.yml');

  try {
    if (isYaml) {
      rawConfig = parseYaml(content);
    } else {
      rawConfig = JSON.parse(content);
    }
  } catch (error) {
    const format = isYaml ? 'YAML' : 'JSON';
    throw new ConfigLoadError(`Failed to parse ${format} config: ${configPath}`, configPath, error);
  }

  // Validate with Zod
  const result = ImpactConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new ConfigValidationError(`Invalid config: ${configPath}`, errors);
  }

  return result.data;
}

/**
 * Convert kebab-case YAML keys to camelCase for TypeScript
 */
export function normalizeConfig(config: ValidatedImpactConfig): ImpactConfig {
  return {
    repos: config.repos.map((repo) => ({
      name: repo.name,
      path: repo.path,
      type: repo.type,
      analyzers: repo.analyzers,
      includePaths: repo.includePaths,
      excludePaths: repo.excludePaths,
    })),
    relations: config.relations.map((rel) => ({
      from: rel.from,
      to: rel.to,
      via: rel.via,
      patterns: rel.patterns,
    })),
    output: {
      githubComment: config.output.githubComment,
      githubCheck: config.output.githubCheck,
      slack: config.output.slack,
    },
    llm: config.llm
      ? {
          enabled: config.llm.enabled,
          provider: config.llm.provider,
          model: config.llm.model,
          maxTokens: config.llm.maxTokens,
          secretsFilter: config.llm.secretsFilter,
        }
      : undefined,
  };
}

/**
 * Get default config file path candidates
 */
export function getDefaultConfigPaths(): string[] {
  return ['impact.config.yaml', 'impact.config.yml', 'impact.config.json', '.impactrc.yaml', '.impactrc.json'];
}

/**
 * Find config file in current directory
 */
export async function findConfig(basePath: string = '.'): Promise<string | null> {
  for (const candidate of getDefaultConfigPaths()) {
    const fullPath = `${basePath}/${candidate}`;
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}
