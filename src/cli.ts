#!/usr/bin/env node

import { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, normalizeConfig, findConfig, ConfigLoadError, ConfigValidationError } from './config/index.js';
import { AngularAnalyzer } from './analyzers/index.js';
import type {
  AnalysisResult,
  AnalyzeOptions,
  ImpactConfig,
  ImpactItem,
  RepoConfig,
  RepoResult,
} from './types/index.js';

const VERSION = '0.1.0';

/**
 * Create the CLI program
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name('impact')
    .description('Cross-repo impact analyzer for monorepo and multi-repo setups')
    .version(VERSION);

  // Main analyze command
  program
    .command('analyze')
    .description('Analyze impact of changes between two git refs')
    .option('-c, --config <path>', 'Path to config file')
    .option('-b, --base <ref>', 'Base git reference (e.g., origin/develop)', 'origin/develop')
    .option('-h, --head <ref>', 'Head git reference (e.g., HEAD)', 'HEAD')
    .option('-o, --output <dir>', 'Output directory', './impact-output')
    .option('-f, --format <formats>', 'Output formats (json,markdown,github)', 'json,markdown')
    .action(async (options: AnalyzeOptions) => {
      await runAnalysis(options);
    });

  // Validate config command
  program
    .command('validate')
    .description('Validate a config file')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (options: { config?: string }) => {
      await validateConfig(options.config);
    });

  // Init command
  program
    .command('init')
    .description('Initialize a new impact config file')
    .option('-f, --format <format>', 'Config format (yaml or json)', 'yaml')
    .action(async (options: { format: string }) => {
      await initConfig(options.format);
    });

  return program;
}

/**
 * Run the impact analysis
 */
async function runAnalysis(options: AnalyzeOptions): Promise<void> {
  console.log('🔍 Impact Analyzer v' + VERSION);
  console.log('');

  // Find and load config
  let configPath: string | undefined = options.config;
  if (!configPath) {
    configPath = (await findConfig()) ?? undefined;
    if (!configPath) {
      console.error('❌ No config file found. Create one with: impact init');
      process.exit(1);
    }
  }

  console.log(`📄 Loading config from ${configPath}`);

  let config: ImpactConfig;
  try {
    const rawConfig = await loadConfig(configPath);
    config = normalizeConfig(rawConfig);
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      console.error(`❌ Failed to load config: ${error.message}`);
    } else if (error instanceof ConfigValidationError) {
      console.error(`❌ Invalid config:`);
      error.errors.forEach(e => console.error(`   - ${e}`));
    } else {
      console.error(`❌ Unexpected error: ${error}`);
    }
    process.exit(1);
  }

  console.log(`📊 Analyzing ${config.repos.length} repositories`);
  console.log(`   Base: ${options.base}`);
  console.log(`   Head: ${options.head}`);
  console.log('');

  // Run analysis for each repo
  const repoResults: RepoResult[] = [];
  let totalChangedFiles = 0;
  let totalImpactedComponents = 0;

  for (const repoConfig of config.repos) {
    console.log(`🔄 Analyzing ${repoConfig.name}...`);

    const result = await analyzeRepo(repoConfig, options.base, options.head);
    repoResults.push(result);

    totalChangedFiles += result.changedFiles;
    totalImpactedComponents += result.impacts.length;

    console.log(`   ✅ ${result.changedFiles} changed files, ${result.impacts.length} impacts`);
  }

  // Build analysis result
  const analysisResult: AnalysisResult = {
    meta: {
      timestamp: new Date().toISOString(),
      baseRef: options.base,
      headRef: options.head,
      tool: '@codeculture/impact-analyzer',
      version: VERSION,
    },
    summary: {
      totalChangedFiles,
      totalImpactedComponents,
      hasBreakingChanges: false, // TODO: implement breaking change detection
      repos: repoResults.map(r => ({
        name: r.name,
        changedFiles: r.changedFiles,
        impactCount: r.impacts.length,
      })),
    },
    repos: repoResults,
    crossRepoImpacts: [], // TODO: implement cross-repo impact detection
  };

  // Ensure output directory exists
  const outputDir = resolve(options.output);
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // Write output files
  const formats = options.format.split(',').map(f => f.trim());

  if (formats.includes('json')) {
    const jsonPath = join(outputDir, 'impact.json');
    await writeFile(jsonPath, JSON.stringify(analysisResult, null, 2));
    console.log(`\n📝 JSON output: ${jsonPath}`);
  }

  if (formats.includes('markdown')) {
    const mdPath = join(outputDir, 'impact.md');
    const markdown = generateMarkdown(analysisResult);
    await writeFile(mdPath, markdown);
    console.log(`📝 Markdown output: ${mdPath}`);
  }

  if (formats.includes('github')) {
    const ghPath = join(outputDir, 'github-comment.md');
    const ghComment = generateGitHubComment(analysisResult);
    await writeFile(ghPath, ghComment);
    console.log(`📝 GitHub comment: ${ghPath}`);
  }

  console.log('\n✅ Analysis complete!');
  console.log(`   Total changed files: ${totalChangedFiles}`);
  console.log(`   Total impacted components: ${totalImpactedComponents}`);
}

/**
 * Analyze a single repository
 */
async function analyzeRepo(
  config: RepoConfig,
  baseRef: string,
  headRef: string
): Promise<RepoResult> {
  const impacts: ImpactItem[] = [];
  const errors: string[] = [];

  // Run appropriate analyzers based on repo type and config
  for (const analyzerType of config.analyzers) {
    try {
      let analyzerImpacts: ImpactItem[] = [];

      switch (analyzerType) {
        case 'ts-morph':
          if (config.type === 'angular') {
            const analyzer = new AngularAnalyzer(config, baseRef, headRef);
            analyzerImpacts = await analyzer.analyze();
          }
          // TODO: Add React, Vue analyzers
          break;

        case 'nx':
          // TODO: Implement NxAnalyzer
          break;

        case 'madge':
          // TODO: Implement MadgeAnalyzer
          break;

        case 'graphql-inspector':
          // TODO: Implement GraphQLAnalyzer
          break;

        case 'go-ast':
          // TODO: Implement GoAnalyzer
          break;
      }

      impacts.push(...analyzerImpacts);
    } catch (error) {
      errors.push(`${analyzerType}: ${error}`);
    }
  }

  // Calculate changed files (simplified - in production, get from git)
  const changedFileCount = new Set(impacts.map(i => i.file)).size;

  return {
    name: config.name,
    changedFiles: changedFileCount,
    impacts,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Generate markdown output
 */
function generateMarkdown(result: AnalysisResult): string {
  let md = `# Impact Analysis Report

**Generated:** ${result.meta.timestamp}
**Base:** \`${result.meta.baseRef}\`
**Head:** \`${result.meta.headRef}\`

## Summary

| Metric | Value |
|--------|-------|
| Total Changed Files | ${result.summary.totalChangedFiles} |
| Total Impacted Components | ${result.summary.totalImpactedComponents} |
| Breaking Changes | ${result.summary.hasBreakingChanges ? '⚠️ Yes' : '✅ No'} |

## Per-Repository Summary

| Repository | Changed Files | Impacted Components |
|------------|---------------|---------------------|
`;

  for (const repo of result.summary.repos) {
    md += `| ${repo.name} | ${repo.changedFiles} | ${repo.impactCount} |\n`;
  }

  md += '\n## Detailed Impacts\n\n';

  for (const repo of result.repos) {
    if (repo.impacts.length === 0) continue;

    md += `### ${repo.name}\n\n`;

    for (const impact of repo.impacts) {
      md += `#### ${impact.component}\n\n`;
      md += `- **File:** \`${impact.file}\`\n`;

      if (impact.reasons.length > 0) {
        md += `- **Reasons:**\n`;
        for (const reason of impact.reasons) {
          md += `  - [${reason.type}] ${reason.description}\n`;
        }
      }

      md += '\n';
    }
  }

  return md;
}

/**
 * Generate GitHub PR comment
 */
function generateGitHubComment(result: AnalysisResult): string {
  let comment = `## 🔍 Impact Analysis

| Metric | Value |
|--------|-------|
| Changed Files | ${result.summary.totalChangedFiles} |
| Impacted Components | ${result.summary.totalImpactedComponents} |
| Breaking Changes | ${result.summary.hasBreakingChanges ? '⚠️ Yes' : '✅ No'} |

`;

  if (result.summary.totalImpactedComponents === 0) {
    comment += '✅ **No component impacts detected.**\n';
    return comment;
  }

  comment += `<details>\n<summary>📋 Impacted Components (${result.summary.totalImpactedComponents})</summary>\n\n`;

  for (const repo of result.repos) {
    if (repo.impacts.length === 0) continue;

    comment += `### ${repo.name}\n\n`;

    for (const impact of repo.impacts) {
      comment += `- **${impact.component}** (\`${impact.file}\`)\n`;
      for (const reason of impact.reasons) {
        comment += `  - ${reason.description}\n`;
      }
    }

    comment += '\n';
  }

  comment += '</details>\n\n';
  comment += `---\n*Generated by [@codeculture/impact-analyzer](https://github.com/codeculturehq/impact-analyzer) v${VERSION}*\n`;

  return comment;
}

/**
 * Validate config file
 */
async function validateConfig(configPath?: string): Promise<void> {
  console.log('🔍 Validating config...\n');

  let path = configPath;
  if (!path) {
    path = await findConfig() ?? undefined;
    if (!path) {
      console.error('❌ No config file found');
      process.exit(1);
    }
  }

  try {
    const config = await loadConfig(path);
    console.log(`✅ Config is valid!\n`);
    console.log(`   Repositories: ${config.repos.length}`);
    console.log(`   Relations: ${config.relations.length}`);
    console.log(`   LLM enabled: ${config.llm?.enabled ?? false}`);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error('❌ Config validation failed:\n');
      error.errors.forEach(e => console.error(`   - ${e}`));
    } else if (error instanceof ConfigLoadError) {
      console.error(`❌ Failed to load config: ${error.message}`);
    } else {
      console.error(`❌ Unexpected error: ${error}`);
    }
    process.exit(1);
  }
}

/**
 * Initialize a new config file
 */
async function initConfig(format: string): Promise<void> {
  const filename = format === 'json' ? 'impact.config.json' : 'impact.config.yaml';

  if (existsSync(filename)) {
    console.error(`❌ ${filename} already exists`);
    process.exit(1);
  }

  const template = format === 'json' ? getJsonTemplate() : getYamlTemplate();

  await writeFile(filename, template);
  console.log(`✅ Created ${filename}`);
  console.log('\nEdit the config file to match your repository structure.');
}

function getYamlTemplate(): string {
  return `# Impact Analyzer Configuration
# See https://github.com/codeculturehq/impact-analyzer for documentation

repos:
  - name: frontend
    path: ./frontend
    type: angular
    analyzers:
      - ts-morph
    # includePaths:
    #   - src/app
    # excludePaths:
    #   - src/assets

  # - name: api
  #   path: ./api
  #   type: graphql-node
  #   analyzers:
  #     - ts-morph
  #     - graphql-inspector

relations: []
  # - from: frontend
  #   to: api
  #   via: graphql-schema
  #   patterns:
  #     - '**/*.graphql'

output:
  githubComment: true
  githubCheck: true
  # slack:
  #   channel: '#deployments'
  #   webhook: \${SLACK_WEBHOOK_URL}

# llm:
#   enabled: false
#   provider: claude
#   model: claude-3-5-sonnet-latest
#   secretsFilter: true
`;
}

function getJsonTemplate(): string {
  return JSON.stringify({
    repos: [
      {
        name: 'frontend',
        path: './frontend',
        type: 'angular',
        analyzers: ['ts-morph'],
      },
    ],
    relations: [],
    output: {
      githubComment: true,
      githubCheck: true,
    },
  }, null, 2);
}

// Run CLI
const program = createProgram();
program.parse();
