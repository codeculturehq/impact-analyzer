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
 * Generate test hints for an impact item using LLM
 */
async function generateTestHints(
  impact: ImpactItem,
  options: EnhanceOptions
): Promise<string[]> {
  const prompt = buildPrompt(impact);

  try {
    let response: string;

    switch (options.provider) {
      case 'claude':
        response = await callClaude(prompt, options);
        break;
      case 'codex':
        response = await callCodex(prompt, options);
        break;
      case 'gemini':
        response = await callGemini(prompt, options);
        break;
      default:
        throw new Error(`Unknown LLM provider: ${options.provider}`);
    }

    return parseTestHints(response);
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

/**
 * Call Claude API
 */
async function callClaude(prompt: string, options: EnhanceOptions): Promise<string> {
  const apiKey = options.apiKey || process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for Claude');
  }

  const model = options.model || 'claude-3-5-sonnet-latest';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text || '';
}

/**
 * Call OpenAI Codex/GPT API
 */
async function callCodex(prompt: string, options: EnhanceOptions): Promise<string> {
  const apiKey = options.apiKey || process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for Codex');
  }

  const model = options.model || 'gpt-4o';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || '';
}

/**
 * Call Google Gemini API
 */
async function callGemini(prompt: string, options: EnhanceOptions): Promise<string> {
  const apiKey = options.apiKey || process.env['GOOGLE_API_KEY'];
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY environment variable is required for Gemini');
  }

  const model = options.model || 'gemini-1.5-flash';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: options.maxTokens || 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content?.parts[0]?.text || '';
}
