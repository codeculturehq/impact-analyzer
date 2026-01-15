import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { execa } from 'execa';
import type { AnalysisResult, ImpactItem, LLMProvider, RepoResult } from '../types/index.js';
import { filterAnalysisResult } from './secrets-filter.js';

export interface EnhanceOptions {
  provider: LLMProvider;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  secretsFilter?: boolean;
  /** Include git diff in context (default: true) */
  includeCodeDiff?: boolean;
  /** Maximum diff lines per file (default: 100) */
  maxDiffLines?: number;
  /** Batch related impacts together (default: true) */
  batchRelated?: boolean;
  /** Maximum estimated tokens per batch (default: 4000) */
  maxBatchTokens?: number;
  /** Skip executive summary generation (default: false) */
  skipSummary?: boolean;
}

export interface EnhancedImpact extends ImpactItem {
  testHints: string[];
  riskLevel: 'low' | 'medium' | 'high';
  reviewFocus: string[];
  affectedFlows?: string[];
}

export interface EnhancedRepoResult extends Omit<RepoResult, 'impacts'> {
  impacts: EnhancedImpact[];
}

export interface EnhancedResult extends Omit<AnalysisResult, 'repos'> {
  repos: EnhancedRepoResult[];
  enhanced: boolean;
  llmProvider: LLMProvider;
  /** Executive summary for the whole analysis */
  executiveSummary?: string;
  /** Number of API calls made */
  apiCallCount?: number;
}

interface DiffContext {
  file: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Enhanced analysis with richer context and batched processing
 */
export async function enhanceWithLLMv2(
  result: AnalysisResult,
  options: EnhanceOptions,
  repoConfigs?: Array<{ name: string; path: string }>
): Promise<EnhancedResult> {
  // Filter secrets if enabled (default: true)
  const filteredResult = options.secretsFilter !== false
    ? filterAnalysisResult(result)
    : result;

  // Collect diffs for all changed files if enabled
  const diffMap = new Map<string, DiffContext>();
  if (options.includeCodeDiff !== false && repoConfigs) {
    for (const repoConfig of repoConfigs) {
      const repo = filteredResult.repos.find(r => r.name === repoConfig.name);
      if (!repo) continue;

      // Collect ALL source files from impact reasons (not just impact files)
      // This includes files that caused indirect impacts
      const sourceFiles = new Set<string>();
      for (const impact of repo.impacts) {
        sourceFiles.add(impact.file); // The impacted file itself
        for (const reason of impact.reasons) {
          if (reason.source) {
            sourceFiles.add(reason.source); // Files that caused the impact
          }
        }
      }

      const files = [...sourceFiles];
      for (const file of files) {
        const diff = await getFileDiff(
          repoConfig.path,
          file,
          result.meta.baseRef,
          result.meta.headRef,
          options.maxDiffLines ?? 100
        );
        if (diff) {
          diffMap.set(`${repoConfig.name}:${file}`, diff);
        }
      }
    }
  }

  // Process repos - batch related impacts together with token-aware batching
  const enhancedRepos: EnhancedRepoResult[] = [];
  let apiCallCount = 0;
  const maxBatchTokens = options.maxBatchTokens ?? 4000;

  for (const repo of filteredResult.repos) {
    if (options.batchRelated !== false) {
      // Group impacts by file first
      const impactsByFile = groupImpactsByFile(repo.impacts);
      const enhancedImpacts: EnhancedImpact[] = [];

      // Collect file batches with their diffs and token estimates
      const fileBatches: Array<{ file: string; impacts: ImpactItem[]; diffs: DiffContext[]; tokens: number }> = [];

      for (const [file, impacts] of impactsByFile) {
        const diffs: DiffContext[] = [];
        const diffForFile = diffMap.get(`${repo.name}:${file}`);
        if (diffForFile) diffs.push(diffForFile);

        // Add diffs from source files (for indirect impacts)
        for (const impact of impacts) {
          for (const reason of impact.reasons) {
            if (reason.source && reason.source !== file) {
              const sourceDiff = diffMap.get(`${repo.name}:${reason.source}`);
              if (sourceDiff && !diffs.find(d => d.file === sourceDiff.file)) {
                diffs.push(sourceDiff);
              }
            }
          }
        }

        // Estimate tokens (rough: chars / 4)
        const diffChars = diffs.reduce((sum, d) => sum + d.diff.length, 0);
        const impactChars = impacts.reduce((sum, i) =>
          sum + i.component.length + i.file.length + i.reasons.reduce((s, r) => s + r.description.length, 0), 0);
        const estimatedTokens = Math.ceil((diffChars + impactChars + 500) / 4); // +500 for prompt overhead

        fileBatches.push({ file, impacts, diffs, tokens: estimatedTokens });
      }

      // Group file batches into API calls based on token budget
      const apiBatches: Array<{ impacts: ImpactItem[]; diffs: DiffContext[] }> = [];
      let currentBatch: { impacts: ImpactItem[]; diffs: DiffContext[]; tokens: number } = { impacts: [], diffs: [], tokens: 0 };

      for (const fileBatch of fileBatches) {
        // If adding this file would exceed budget, start a new batch
        if (currentBatch.impacts.length > 0 && currentBatch.tokens + fileBatch.tokens > maxBatchTokens) {
          apiBatches.push({ impacts: currentBatch.impacts, diffs: currentBatch.diffs });
          currentBatch = { impacts: [], diffs: [], tokens: 0 };
        }

        currentBatch.impacts.push(...fileBatch.impacts);
        // Add diffs without duplicates
        for (const diff of fileBatch.diffs) {
          if (!currentBatch.diffs.find(d => d.file === diff.file)) {
            currentBatch.diffs.push(diff);
          }
        }
        currentBatch.tokens += fileBatch.tokens;
      }

      // Don't forget the last batch
      if (currentBatch.impacts.length > 0) {
        apiBatches.push({ impacts: currentBatch.impacts, diffs: currentBatch.diffs });
      }

      // Process each API batch
      for (const batch of apiBatches) {
        const batchResult = await processBatchedImpacts(batch.impacts, batch.diffs, options);
        enhancedImpacts.push(...batchResult);
        apiCallCount++;
      }

      enhancedRepos.push({
        ...repo,
        impacts: enhancedImpacts,
      });
    } else {
      // Process each impact individually (legacy behavior)
      const enhancedImpacts: EnhancedImpact[] = [];
      for (const impact of repo.impacts) {
        const diff = diffMap.get(`${repo.name}:${impact.file}`);
        const enhanced = await processImpact(impact, diff, options);
        enhancedImpacts.push(enhanced);
      }
      enhancedRepos.push({
        ...repo,
        impacts: enhancedImpacts,
      });
    }
  }

  // Generate executive summary
  const executiveSummary = await generateExecutiveSummary(
    filteredResult,
    enhancedRepos,
    options
  );
  apiCallCount++; // +1 for executive summary

  return {
    ...filteredResult,
    repos: enhancedRepos,
    enhanced: true,
    llmProvider: options.provider,
    executiveSummary,
    apiCallCount,
  };
}

/**
 * Get git diff for a specific file
 */
async function getFileDiff(
  repoPath: string,
  file: string,
  baseRef: string,
  headRef: string,
  maxLines: number
): Promise<DiffContext | null> {
  try {
    const { stdout } = await execa('git', [
      'diff',
      `${baseRef}..${headRef}`,
      '--',
      file,
    ], { cwd: repoPath });

    if (!stdout) return null;

    // Count added/removed lines
    const lines = stdout.split('\n');
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) linesAdded++;
      if (line.startsWith('-') && !line.startsWith('---')) linesRemoved++;
    }

    // Truncate if too long
    const truncatedDiff = lines.slice(0, maxLines).join('\n');
    const wasTruncated = lines.length > maxLines;

    return {
      file,
      diff: wasTruncated ? truncatedDiff + '\n... (truncated)' : truncatedDiff,
      linesAdded,
      linesRemoved,
    };
  } catch {
    return null;
  }
}

/**
 * Group impacts by file for batched processing
 */
function groupImpactsByFile(impacts: ImpactItem[]): Map<string, ImpactItem[]> {
  const grouped = new Map<string, ImpactItem[]>();
  for (const impact of impacts) {
    const existing = grouped.get(impact.file) || [];
    existing.push(impact);
    grouped.set(impact.file, existing);
  }
  return grouped;
}

/**
 * Process multiple impacts from the same file in one LLM call
 */
async function processBatchedImpacts(
  impacts: ImpactItem[],
  diffs: DiffContext[],
  options: EnhanceOptions
): Promise<EnhancedImpact[]> {
  const prompt = buildBatchedPrompt(impacts, diffs);

  try {
    const model = getModel(options);
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: options.maxTokens || 2048,
    });

    return parseBatchedResponse(text, impacts);
  } catch (error) {
    console.warn(`Failed to enhance impacts for ${impacts[0]?.file}: ${error}`);
    // Return impacts with empty enhancements
    return impacts.map(impact => ({
      ...impact,
      testHints: [],
      riskLevel: 'medium' as const,
      reviewFocus: [],
    }));
  }
}

/**
 * Process a single impact (legacy mode)
 */
async function processImpact(
  impact: ImpactItem,
  diff: DiffContext | null | undefined,
  options: EnhanceOptions
): Promise<EnhancedImpact> {
  const prompt = buildSinglePrompt(impact, diff);

  try {
    const model = getModel(options);
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: options.maxTokens || 1024,
    });

    return parseSingleResponse(text, impact);
  } catch (error) {
    console.warn(`Failed to enhance ${impact.component}: ${error}`);
    return {
      ...impact,
      testHints: [],
      riskLevel: 'medium',
      reviewFocus: [],
    };
  }
}

/**
 * Build prompt for batched impacts (same file)
 */
function buildBatchedPrompt(impacts: ImpactItem[], diffs: DiffContext[]): string {
  const firstImpact = impacts[0];
  if (!firstImpact) {
    throw new Error('No impacts provided');
  }

  const components = impacts.map(i => i.component).join(', ');
  const reasons = impacts.flatMap(i =>
    i.reasons.map(r => `- ${i.component}: [${r.type}] ${r.description}`)
  ).join('\n');

  let prompt = `Analyze the following code changes and provide actionable insights for developers.

## Impacted File
**File:** ${firstImpact.file}
**Repository:** ${firstImpact.repo}
**Affected Components:** ${components}

## Impact Reasons
${reasons}
`;

  // Include all relevant diffs
  if (diffs.length > 0) {
    prompt += '\n## Code Changes\n';
    for (const diff of diffs) {
      prompt += `
### ${diff.file} (+${diff.linesAdded}/-${diff.linesRemoved} lines)
\`\`\`diff
${diff.diff}
\`\`\`
`;
    }
  } else {
    prompt += '\n**Note:** No code diff available - this is likely an indirect impact from a dependency change.\n';
  }

  prompt += `
## Required Output
For EACH component (${components}), provide a JSON object with this EXACT structure:

\`\`\`json
{
  "components": [
    {
      "name": "ComponentName",
      "riskLevel": "low|medium|high",
      "testHints": [
        "Specific test case 1",
        "Specific test case 2"
      ],
      "reviewFocus": [
        "What reviewers should pay attention to"
      ],
      "affectedFlows": [
        "User flow that might be affected"
      ]
    }
  ]
}
\`\`\`

Guidelines:
- **riskLevel**: "high" if breaking changes, API changes, or security implications; "medium" if logic changes; "low" if cosmetic/refactoring
- **testHints**: 2-4 SPECIFIC test cases based on the actual code changes shown in the diff
- **reviewFocus**: 1-2 specific areas reviewers should check
- **affectedFlows**: User-facing features that might be impacted (optional)

IMPORTANT: Output ONLY the JSON, no additional text.`;

  return prompt;
}

/**
 * Build prompt for single impact (legacy mode)
 */
function buildSinglePrompt(impact: ImpactItem, diff: DiffContext | null | undefined): string {
  const reasons = impact.reasons
    .map(r => `- [${r.type}] ${r.description}`)
    .join('\n');

  let prompt = `Analyze this code change and provide actionable insights.

**Component:** ${impact.component}
**File:** ${impact.file}
**Repository:** ${impact.repo}

**Impact Reasons:**
${reasons}
`;

  if (diff) {
    prompt += `
**Code Diff:**
\`\`\`diff
${diff.diff}
\`\`\`
`;
  }

  prompt += `
Respond with JSON only:
\`\`\`json
{
  "riskLevel": "low|medium|high",
  "testHints": ["specific test 1", "specific test 2"],
  "reviewFocus": ["what to review"],
  "affectedFlows": ["affected user flow"]
}
\`\`\``;

  return prompt;
}

/**
 * Parse batched LLM response
 */
function parseBatchedResponse(response: string, impacts: ImpactItem[]): EnhancedImpact[] {
  try {
    // Try multiple extraction patterns for flexibility
    let jsonStr: string | null = null;

    // Pattern 1: JSON in code block
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Pattern 2: Raw JSON object with "components" key
    if (!jsonStr) {
      const rawJsonMatch = response.match(/\{[\s\S]*"components"\s*:\s*\[[\s\S]*\]\s*\}/);
      if (rawJsonMatch) {
        jsonStr = rawJsonMatch[0];
      }
    }

    // Pattern 3: Try to find any JSON array of components
    if (!jsonStr) {
      const arrayMatch = response.match(/\[\s*\{[\s\S]*"name"\s*:[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        jsonStr = `{"components": ${arrayMatch[0]}}`;
      }
    }

    if (!jsonStr) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonStr);

    // Map parsed components back to impacts
    return impacts.map(impact => {
      const components = parsed.components as Array<{
        name: string;
        riskLevel?: string;
        testHints?: string[];
        reviewFocus?: string[];
        affectedFlows?: string[];
      }> | undefined;
      const componentData = components?.find(c => c.name === impact.component);

      return {
        ...impact,
        testHints: componentData?.testHints || [],
        riskLevel: (componentData?.riskLevel as 'low' | 'medium' | 'high') || 'medium',
        reviewFocus: componentData?.reviewFocus || [],
        affectedFlows: componentData?.affectedFlows,
      };
    });
  } catch (error) {
    console.warn(`Failed to parse batched response: ${error}`);
    return impacts.map(impact => ({
      ...impact,
      testHints: [],
      riskLevel: 'medium' as const,
      reviewFocus: [],
    }));
  }
}

/**
 * Parse single impact LLM response
 */
function parseSingleResponse(response: string, impact: ImpactItem): EnhancedImpact {
  try {
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                      response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr);

    return {
      ...impact,
      testHints: parsed.testHints || [],
      riskLevel: parsed.riskLevel || 'medium',
      reviewFocus: parsed.reviewFocus || [],
      affectedFlows: parsed.affectedFlows,
    };
  } catch {
    return {
      ...impact,
      testHints: [],
      riskLevel: 'medium',
      reviewFocus: [],
    };
  }
}

/**
 * Generate executive summary of all changes
 */
async function generateExecutiveSummary(
  result: AnalysisResult,
  enhancedRepos: EnhancedRepoResult[],
  options: EnhanceOptions
): Promise<string> {
  // Count risk levels
  const riskCounts = { high: 0, medium: 0, low: 0 };
  const allTestHints: string[] = [];
  const allReviewFocus: string[] = [];

  for (const repo of enhancedRepos) {
    for (const impact of repo.impacts) {
      riskCounts[impact.riskLevel]++;
      allTestHints.push(...impact.testHints);
      allReviewFocus.push(...impact.reviewFocus);
    }
  }

  const prompt = `Generate a brief executive summary (3-5 sentences) for a code review based on this analysis:

**Changes Overview:**
- Total changed files: ${result.summary.totalChangedFiles}
- Total impacted components: ${result.summary.totalImpactedComponents}
- Breaking changes detected: ${result.summary.hasBreakingChanges ? 'Yes' : 'No'}
- Risk distribution: ${riskCounts.high} high, ${riskCounts.medium} medium, ${riskCounts.low} low

**Repositories affected:**
${result.summary.repos.map(r => `- ${r.name}: ${r.impactCount} components`).join('\n')}

**Key review areas:**
${[...new Set(allReviewFocus)].slice(0, 5).map(f => `- ${f}`).join('\n')}

Write a concise summary highlighting the most important aspects for reviewers.
Output only the summary text, no formatting.`;

  try {
    const model = getModel(options);
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 300,
    });
    return text.trim();
  } catch {
    return `Analysis complete: ${result.summary.totalImpactedComponents} components impacted across ${result.summary.repos.length} repositories. ${riskCounts.high} high-risk changes require attention.`;
  }
}

/**
 * Get the AI SDK model based on provider
 */
function getModel(options: EnhanceOptions) {
  const { provider, apiKey, model } = options;

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: apiKey || process.env['OPENAI_API_KEY'],
      });
      return openai(model || 'gpt-4o');
    }

    case 'claude': {
      const anthropic = createAnthropic({
        apiKey: apiKey || process.env['ANTHROPIC_API_KEY'],
      });
      return anthropic(model || 'claude-sonnet-4-20250514');
    }

    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey || process.env['GOOGLE_API_KEY'],
      });
      return google(model || 'gemini-2.0-flash');
    }

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
