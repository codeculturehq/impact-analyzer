import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { AnalysisResult, ImpactItem, LLMProvider } from '../types/index.js';
import { filterAnalysisResult } from './secrets-filter.js';

export interface EnhanceOptions {
  provider: LLMProvider;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  secretsFilter?: boolean;
}

export interface EnhancedResult extends AnalysisResult {
  enhanced: boolean;
  llmProvider: LLMProvider;
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

  // Generate test hints for each impact
  const enhancedRepos = await Promise.all(
    filteredResult.repos.map(async (repo) => ({
      ...repo,
      impacts: await Promise.all(
        repo.impacts.map(async (impact) => ({
          ...impact,
          testHints: await generateTestHints(impact, options),
        }))
      ),
    }))
  );

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

    case 'github-models': {
      // GitHub Models uses OpenAI-compatible API
      const github = createOpenAI({
        baseURL: 'https://models.github.ai/inference',
        apiKey: apiKey || process.env['GITHUB_TOKEN'],
      });
      // Model format: {publisher}/{model_name}
      let modelId = model || 'openai/gpt-4.1';
      if (!modelId.includes('/')) {
        modelId = `openai/${modelId}`;
      }
      return github(modelId);
    }

    case 'claude': {
      // For Claude, fall back to raw fetch (AI SDK requires @ai-sdk/anthropic)
      throw new Error('Claude provider requires @ai-sdk/anthropic - install it or use openai/github-models');
    }

    case 'gemini': {
      // For Gemini, fall back to raw fetch (AI SDK requires @ai-sdk/google)
      throw new Error('Gemini provider requires @ai-sdk/google - install it or use openai/github-models');
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
