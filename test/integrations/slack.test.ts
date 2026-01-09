import { describe, it, expect } from 'vitest';
import { generateSlackMessage, generateSimpleSlackText } from '../../src/integrations/slack.js';
import type { AnalysisResult } from '../../src/types/index.js';

describe('Slack Integration', () => {
  describe('generateSlackMessage', () => {
    it('should generate message for result with no impacts', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 0,
          totalImpactedComponents: 0,
          hasBreakingChanges: false,
          repos: [],
        },
      };

      const message = generateSlackMessage(result);

      expect(message.text).toContain('No impacts detected');
      expect(message.blocks).toBeDefined();
      expect(message.blocks?.length).toBeGreaterThan(0);
      expect(message.attachments?.[0]?.color).toBe('#36A64F'); // Green
    });

    it('should generate message for result with impacts', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [
          {
            name: 'frontend',
            changedFiles: 5,
            impacts: [
              {
                component: 'UserComponent',
                file: 'user.component.ts',
                repo: 'frontend',
                reasons: [{ type: 'direct', source: 'user.component.ts', description: 'Direct change' }],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 5,
          totalImpactedComponents: 1,
          hasBreakingChanges: false,
          repos: [{ name: 'frontend', changedFiles: 5, impactCount: 1 }],
        },
      };

      const message = generateSlackMessage(result);

      expect(message.text).toContain('Impacts detected');
      expect(message.attachments?.[0]?.color).toBe('#FFA500'); // Orange
    });

    it('should generate message for result with breaking changes', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [
          {
            name: 'api',
            changedFiles: 2,
            impacts: [
              {
                component: 'UserQuery',
                file: 'schema.graphql',
                repo: 'api',
                reasons: [{ type: 'schema', source: 'schema.graphql', description: 'Breaking schema change' }],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 2,
          totalImpactedComponents: 1,
          hasBreakingChanges: true,
          repos: [{ name: 'api', changedFiles: 2, impactCount: 1 }],
        },
      };

      const message = generateSlackMessage(result);

      expect(message.text).toContain('Breaking changes detected');
      expect(message.attachments?.[0]?.color).toBe('#FF0000'); // Red
    });

    it('should include cross-repo impacts in message', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [],
        crossRepoImpacts: [
          {
            sourceRepo: 'api',
            targetRepo: 'frontend',
            sourceComponent: 'UserQuery',
            targetComponents: ['UserService', 'UserComponent'],
            relation: 'graphql-schema',
          },
        ],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 0,
          hasBreakingChanges: false,
          repos: [],
        },
      };

      const message = generateSlackMessage(result);
      const messageText = JSON.stringify(message.blocks);

      expect(messageText).toContain('api');
      expect(messageText).toContain('frontend');
      expect(messageText).toContain('UserQuery');
    });

    it('should set channel when provided', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 0,
          totalImpactedComponents: 0,
          hasBreakingChanges: false,
          repos: [],
        },
      };

      const message = generateSlackMessage(result, '#ci-notifications');

      expect(message.channel).toBe('#ci-notifications');
    });

    it('should truncate long cross-repo impacts list', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [],
        crossRepoImpacts: Array.from({ length: 10 }, (_, i) => ({
          sourceRepo: 'api',
          targetRepo: `service-${i}`,
          sourceComponent: 'SharedType',
          targetComponents: ['Component'],
          relation: 'shared-types' as const,
        })),
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 0,
          hasBreakingChanges: false,
          repos: [],
        },
      };

      const message = generateSlackMessage(result);
      const messageText = JSON.stringify(message.blocks);

      // Should show only 5 and indicate more
      expect(messageText).toContain('+5 more cross-repo impacts');
    });
  });

  describe('generateSimpleSlackText', () => {
    it('should generate simple text summary', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 5,
          totalImpactedComponents: 2,
          hasBreakingChanges: false,
          repos: [],
        },
      };

      const text = generateSimpleSlackText(result);

      expect(text).toContain('Impact Analysis Summary');
      expect(text).toContain('Changed Files: 5');
      expect(text).toContain('Impacted Components: 2');
      expect(text).toContain('Breaking Changes: No');
    });

    it('should include breaking changes emoji when present', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: true,
          repos: [],
        },
      };

      const text = generateSimpleSlackText(result);

      expect(text).toContain('⚠️');
      expect(text).toContain('Breaking Changes: Yes');
    });

    it('should include cross-repo impacts in simple text', () => {
      const result: AnalysisResult = {
        meta: {
          timestamp: '2024-01-01T00:00:00Z',
          baseRef: 'main',
          headRef: 'feature-branch',
          tool: 'impact-analyzer',
          version: '1.0.0',
        },
        repos: [],
        crossRepoImpacts: [
          {
            sourceRepo: 'api',
            targetRepo: 'frontend',
            sourceComponent: 'UserQuery',
            targetComponents: ['UserService'],
            relation: 'graphql-schema',
          },
        ],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 0,
          hasBreakingChanges: false,
          repos: [],
        },
      };

      const text = generateSimpleSlackText(result);

      expect(text).toContain('Cross-Repo Impacts');
      expect(text).toContain('api → frontend');
    });
  });
});
