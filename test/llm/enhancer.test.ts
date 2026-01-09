import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enhanceWithLLM } from '../../src/llm/enhancer.js';
import type { AnalysisResult } from '../../src/types/index.js';

// Mock the AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({}))),
}));

import { generateText } from 'ai';

describe('LLM Enhancer', () => {
  const mockAnalysisResult: AnalysisResult = {
    repos: [
      {
        name: 'test-repo',
        impacts: [
          {
            component: 'TestComponent',
            file: 'src/components/test.ts',
            repo: 'test-repo',
            reasons: [
              {
                type: 'schema',
                description: 'Modified GraphQL schema field',
              },
            ],
          },
        ],
      },
    ],
    summary: {
      totalChangedFiles: 1,
      totalImpactedComponents: 1,
      hasBreakingChanges: false,
    },
    metadata: {
      baseRef: 'origin/develop',
      headRef: 'HEAD',
      analyzedAt: new Date().toISOString(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('enhanceWithLLM', () => {
    it('should enhance analysis result with test hints', async () => {
      const mockResponse = `1. Unit test: Verify component handles modified schema field correctly
2. Integration test: Test GraphQL query with updated schema
3. Edge case test: Handle null values for modified field
4. Regression test: Ensure existing functionality still works
5. E2E test: Validate full flow with schema changes`;

      vi.mocked(generateText).mockResolvedValue({
        text: mockResponse,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);

      const result = await enhanceWithLLM(mockAnalysisResult, {
        provider: 'openai',
        secretsFilter: false,
      });

      expect(result.enhanced).toBe(true);
      expect(result.llmProvider).toBe('openai');
      expect(result.repos[0].impacts[0].testHints).toHaveLength(5);
      expect(result.repos[0].impacts[0].testHints[0]).toContain('Unit test');
    });

    it('should parse numbered list responses correctly', async () => {
      const mockResponse = `1) First test case
2. Second test case
3: Third test case
4- Fourth test case`;

      vi.mocked(generateText).mockResolvedValue({
        text: mockResponse,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);

      const result = await enhanceWithLLM(mockAnalysisResult, {
        provider: 'openai',
        secretsFilter: false,
      });

      expect(result.repos[0].impacts[0].testHints).toHaveLength(4);
      expect(result.repos[0].impacts[0].testHints[0]).toBe('First test case');
      expect(result.repos[0].impacts[0].testHints[1]).toBe('Second test case');
    });

    it('should limit test hints to 5 per impact', async () => {
      const mockResponse = `1. Test 1
2. Test 2
3. Test 3
4. Test 4
5. Test 5
6. Test 6
7. Test 7`;

      vi.mocked(generateText).mockResolvedValue({
        text: mockResponse,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);

      const result = await enhanceWithLLM(mockAnalysisResult, {
        provider: 'openai',
        secretsFilter: false,
      });

      expect(result.repos[0].impacts[0].testHints).toHaveLength(5);
    });

    it('should handle LLM errors gracefully', async () => {
      vi.mocked(generateText).mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await enhanceWithLLM(mockAnalysisResult, {
        provider: 'openai',
        secretsFilter: false,
      });

      // Should still return result but with empty test hints
      expect(result.enhanced).toBe(true);
      expect(result.repos[0].impacts[0].testHints).toEqual([]);
    });

    it('should set llmProvider in result', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: '1. Test case',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);

      const result = await enhanceWithLLM(mockAnalysisResult, {
        provider: 'claude',
        secretsFilter: false,
      });

      expect(result.llmProvider).toBe('claude');
    });

    it('should handle empty impacts', async () => {
      const emptyResult: AnalysisResult = {
        ...mockAnalysisResult,
        repos: [{ name: 'empty-repo', impacts: [] }],
      };

      const result = await enhanceWithLLM(emptyResult, {
        provider: 'openai',
        secretsFilter: false,
      });

      expect(result.enhanced).toBe(true);
      expect(result.repos[0].impacts).toHaveLength(0);
    });

    it('should process multiple impacts in parallel', async () => {
      const multiImpactResult: AnalysisResult = {
        ...mockAnalysisResult,
        repos: [
          {
            name: 'test-repo',
            impacts: [
              {
                component: 'Component1',
                file: 'src/a.ts',
                repo: 'test-repo',
                reasons: [{ type: 'schema', description: 'Change 1' }],
              },
              {
                component: 'Component2',
                file: 'src/b.ts',
                repo: 'test-repo',
                reasons: [{ type: 'api-call', description: 'Change 2' }],
              },
            ],
          },
        ],
      };

      vi.mocked(generateText).mockResolvedValue({
        text: '1. Test case for component',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);

      const result = await enhanceWithLLM(multiImpactResult, {
        provider: 'openai',
        secretsFilter: false,
      });

      expect(generateText).toHaveBeenCalledTimes(2);
      expect(result.repos[0].impacts).toHaveLength(2);
      expect(result.repos[0].impacts[0].testHints).toHaveLength(1);
      expect(result.repos[0].impacts[1].testHints).toHaveLength(1);
    });
  });

  describe('provider selection', () => {
    it('should use openai provider by default model', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: '1. Test',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);

      await enhanceWithLLM(mockAnalysisResult, {
        provider: 'openai',
        secretsFilter: false,
      });

      expect(generateText).toHaveBeenCalled();
    });

    it('should allow custom model override', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: '1. Test',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never);

      await enhanceWithLLM(mockAnalysisResult, {
        provider: 'openai',
        model: 'gpt-4o',
        secretsFilter: false,
      });

      expect(generateText).toHaveBeenCalled();
    });
  });
});
