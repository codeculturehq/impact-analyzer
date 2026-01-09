import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAnnotations } from '../../src/integrations/github.js';
import type { AnalysisResult } from '../../src/types/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitHub Integration', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('generateAnnotations', () => {
    it('should generate annotations from repo impacts', () => {
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
            changedFiles: 1,
            impacts: [
              {
                component: 'UserComponent',
                file: 'src/app/user/user.component.ts',
                line: 10,
                repo: 'frontend',
                reasons: [
                  { type: 'direct', source: 'user.component.ts', description: 'Direct file change' },
                ],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: false,
          repos: [{ name: 'frontend', changedFiles: 1, impactCount: 1 }],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations).toHaveLength(1);
      expect(annotations[0]).toMatchObject({
        path: 'src/app/user/user.component.ts',
        start_line: 10,
        end_line: 10,
        annotation_level: 'notice',
        title: 'Impact: UserComponent',
      });
    });

    it('should mark schema changes as failure level', () => {
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
            changedFiles: 1,
            impacts: [
              {
                component: 'UserQuery',
                file: 'schema.graphql',
                repo: 'api',
                reasons: [
                  { type: 'schema', source: 'schema.graphql', description: 'Breaking schema change' },
                ],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: true,
          repos: [{ name: 'api', changedFiles: 1, impactCount: 1 }],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations[0]?.annotation_level).toBe('failure');
    });

    it('should mark breaking changes as failure level', () => {
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
            changedFiles: 1,
            impacts: [
              {
                component: 'UserAPI',
                file: 'api.ts',
                repo: 'api',
                reasons: [
                  { type: 'direct', source: 'api.ts', description: 'Breaking API change detected' },
                ],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: true,
          repos: [{ name: 'api', changedFiles: 1, impactCount: 1 }],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations[0]?.annotation_level).toBe('failure');
    });

    it('should mark dependency changes as warning level', () => {
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
            changedFiles: 1,
            impacts: [
              {
                component: 'Dependencies',
                file: 'package.json',
                repo: 'frontend',
                reasons: [
                  { type: 'dependency', source: 'package.json', description: 'Dependency updated' },
                ],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: false,
          repos: [{ name: 'frontend', changedFiles: 1, impactCount: 1 }],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations[0]?.annotation_level).toBe('warning');
    });

    it('should mark config changes as warning level', () => {
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
            changedFiles: 1,
            impacts: [
              {
                component: 'AngularConfig',
                file: 'angular.json',
                repo: 'frontend',
                reasons: [
                  { type: 'config', source: 'angular.json', description: 'Build config changed' },
                ],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: false,
          repos: [{ name: 'frontend', changedFiles: 1, impactCount: 1 }],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations[0]?.annotation_level).toBe('warning');
    });

    it('should add cross-repo impact annotations', () => {
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
          totalChangedFiles: 0,
          totalImpactedComponents: 0,
          hasBreakingChanges: false,
          repos: [],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations).toHaveLength(1);
      expect(annotations[0]).toMatchObject({
        path: 'impact-analysis',
        annotation_level: 'warning',
        title: 'Cross-Repo Impact: api → frontend',
      });
      expect(annotations[0]?.message).toContain('UserService');
      expect(annotations[0]?.message).toContain('UserComponent');
    });

    it('should use line 1 when line is not specified', () => {
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
            changedFiles: 1,
            impacts: [
              {
                component: 'App',
                file: 'src/app.ts',
                repo: 'frontend',
                reasons: [
                  { type: 'direct', source: 'app.ts', description: 'Change detected' },
                ],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: false,
          repos: [{ name: 'frontend', changedFiles: 1, impactCount: 1 }],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations[0]?.start_line).toBe(1);
      expect(annotations[0]?.end_line).toBe(1);
    });

    it('should combine multiple reasons in message', () => {
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
            changedFiles: 1,
            impacts: [
              {
                component: 'UserService',
                file: 'src/service.ts',
                repo: 'frontend',
                reasons: [
                  { type: 'direct', source: 'service.ts', description: 'Direct change' },
                  { type: 'dependency', source: 'api.ts', description: 'Depends on changed API' },
                ],
              },
            ],
          },
        ],
        crossRepoImpacts: [],
        summary: {
          totalChangedFiles: 1,
          totalImpactedComponents: 1,
          hasBreakingChanges: false,
          repos: [{ name: 'frontend', changedFiles: 1, impactCount: 1 }],
        },
      };

      const annotations = generateAnnotations(result);

      expect(annotations[0]?.message).toContain('[direct] Direct change');
      expect(annotations[0]?.message).toContain('[dependency] Depends on changed API');
    });

    it('should return empty array for result with no impacts', () => {
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

      const annotations = generateAnnotations(result);

      expect(annotations).toHaveLength(0);
    });
  });
});
