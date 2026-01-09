import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { AnalysisResult, ImpactItem, LLMProvider } from '../types/index.js';
import { filterAnalysisResult } from './secrets-filter.js';

export interface EnhanceOptions {
  provider: LLMProvider;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  secretsFilter?: boolean;
  /** Maximum concurrent API calls (default: 3) */
  concurrency?: number;
  /** Delay between API calls in ms (default: 100) */
  delayMs?: number;
}

export interface EnhancedResult extends AnalysisResult {
  enhanced: boolean;
  llmProvider: LLMProvider;
}

/**
 * Simple rate limiter using a semaphore pattern
 */
class RateLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(
    private maxConcurrent: number,
    private delayMs: number
  ) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  async release(): Promise<void> {
    // Add delay between releases to avoid bursts
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

/**
 * Enhance analysis result with LLM-generated test hints
 */
export async function enhanceWithLLM(
  result: AnalysisResult,
  options: EnhanceOptions
): Promise<EnhancedResult> {
  // Filter secrets if enabled (default: true)
  const filteredResult = options.secretsFilter !== false
    ? filterAnalysisResult(result)
    : result;

  // Create rate limiter (default: 3 concurrent, 100ms delay)
  const rateLimiter = new RateLimiter(
    options.concurrency ?? 3,
    options.delayMs ?? 100
  );

  // Collect all impacts with their repo index for tracking
  const allImpacts: Array<{ repoIdx: number; impactIdx: number; impact: ImpactItem }> = [];
  filteredResult.repos.forEach((repo, repoIdx) => {
    repo.impacts.forEach((impact, impactIdx) => {
      allImpacts.push({ repoIdx, impactIdx, impact });
    });
  });

  // Process all impacts with rate limiting
  const testHintsMap = new Map<string, string[]>();

  await Promise.all(
    allImpacts.map(async ({ repoIdx, impactIdx, impact }) => {
      await rateLimiter.acquire();
      try {
        const hints = await generateTestHints(impact, options);
        testHintsMap.set(`${repoIdx}-${impactIdx}`, hints);
      } finally {
        await rateLimiter.release();
      }
    })
  );

  // Reconstruct repos with test hints
  const enhancedRepos = filteredResult.repos.map((repo, repoIdx) => ({
    ...repo,
    impacts: repo.impacts.map((impact, impactIdx) => ({
      ...impact,
      testHints: testHintsMap.get(`${repoIdx}-${impactIdx}`) || [],
    })),
  }));

  return {
    ...filteredResult,
    repos: enhancedRepos,
    enhanced: true,
    llmProvider: options.provider,
  };
}

/**
 * Get the AI SDK model based on provider and options
 */
function getModel(options: EnhanceOptions) {
  const { provider, apiKey, model } = options;

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: apiKey || process.env['OPENAI_API_KEY'],
      });
      return openai(model || 'gpt-5.1-codex');
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

/**
 * Generate test hints for an impact item using LLM
 */
async function generateTestHints(
  impact: ImpactItem,
  options: EnhanceOptions
): Promise<string[]> {
  const prompt = buildPrompt(impact);

  try {
    const model = getModel(options);

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: options.maxTokens || 1024,
    });

    return parseTestHints(text);
  } catch (error) {
    console.warn(`Failed to generate test hints for ${impact.component}: ${error}`);
    return [];
  }
}

/**
 * Build the prompt for test hint generation
 */
function buildPrompt(impact: ImpactItem): string {
  const reasons = impact.reasons
    .map((r) => `- [${r.type}] ${r.description}`)
    .join('\n');

  return `Given the following code change impact, suggest specific test cases that should be run or written:

Component: ${impact.component}
File: ${impact.file}
Repository: ${impact.repo}

Impact Reasons:
${reasons}

Please provide 3-5 specific test suggestions in a numbered list. Focus on:
1. Unit tests for the changed component
2. Integration tests that verify the component's interactions
3. Edge cases that might be affected by this change
4. Regression tests to ensure existing functionality still works

Format your response as a numbered list only, with no additional text.`;
}

/**
 * Parse test hints from LLM response
 */
function parseTestHints(response: string): string[] {
  const lines = response.split('\n');
  const hints: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match numbered items like "1.", "2)", "1:", etc.
    const match = trimmed.match(/^\d+[.):\-]\s*(.+)/);
    if (match && match[1]) {
      hints.push(match[1].trim());
    }
  }

  return hints.slice(0, 5); // Max 5 hints per impact
}
