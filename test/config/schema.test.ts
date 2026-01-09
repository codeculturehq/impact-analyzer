import { describe, it, expect } from 'vitest';
import {
  ImpactConfigSchema,
  RepoConfigSchema,
  RelationConfigSchema,
  RepoTypeSchema,
  AnalyzerTypeSchema,
} from '../../src/config/schema.js';

describe('Config Schema', () => {
  describe('RepoTypeSchema', () => {
    it('should accept valid repo types', () => {
      expect(RepoTypeSchema.parse('angular')).toBe('angular');
      expect(RepoTypeSchema.parse('react')).toBe('react');
      expect(RepoTypeSchema.parse('vue')).toBe('vue');
      expect(RepoTypeSchema.parse('nextjs')).toBe('nextjs');
      expect(RepoTypeSchema.parse('graphql-node')).toBe('graphql-node');
      expect(RepoTypeSchema.parse('go')).toBe('go');
      expect(RepoTypeSchema.parse('node')).toBe('node');
    });

    it('should reject invalid repo types', () => {
      expect(() => RepoTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('AnalyzerTypeSchema', () => {
    it('should accept valid analyzer types', () => {
      expect(AnalyzerTypeSchema.parse('nx')).toBe('nx');
      expect(AnalyzerTypeSchema.parse('ts-morph')).toBe('ts-morph');
      expect(AnalyzerTypeSchema.parse('madge')).toBe('madge');
      expect(AnalyzerTypeSchema.parse('graphql-inspector')).toBe('graphql-inspector');
      expect(AnalyzerTypeSchema.parse('go-ast')).toBe('go-ast');
    });

    it('should reject invalid analyzer types', () => {
      expect(() => AnalyzerTypeSchema.parse('invalid')).toThrow();
    });
  });

  describe('RepoConfigSchema', () => {
    it('should accept valid repo config', () => {
      const config = {
        name: 'frontend',
        path: './frontend',
        type: 'angular',
        analyzers: ['ts-morph', 'nx'],
      };

      const result = RepoConfigSchema.parse(config);

      expect(result.name).toBe('frontend');
      expect(result.analyzers).toHaveLength(2);
    });

    it('should accept optional paths', () => {
      const config = {
        name: 'frontend',
        path: './frontend',
        type: 'angular',
        analyzers: ['ts-morph'],
        includePaths: ['src/app'],
        excludePaths: ['src/assets'],
      };

      const result = RepoConfigSchema.parse(config);

      expect(result.includePaths).toEqual(['src/app']);
      expect(result.excludePaths).toEqual(['src/assets']);
    });

    it('should reject empty name', () => {
      const config = {
        name: '',
        path: './frontend',
        type: 'angular',
        analyzers: ['ts-morph'],
      };

      expect(() => RepoConfigSchema.parse(config)).toThrow();
    });

    it('should reject empty analyzers', () => {
      const config = {
        name: 'frontend',
        path: './frontend',
        type: 'angular',
        analyzers: [],
      };

      expect(() => RepoConfigSchema.parse(config)).toThrow();
    });
  });

  describe('RelationConfigSchema', () => {
    it('should accept valid relation config', () => {
      const config = {
        from: 'frontend',
        to: 'api',
        via: 'graphql-schema',
      };

      const result = RelationConfigSchema.parse(config);

      expect(result.from).toBe('frontend');
      expect(result.to).toBe('api');
      expect(result.via).toBe('graphql-schema');
    });

    it('should accept optional patterns', () => {
      const config = {
        from: 'frontend',
        to: 'api',
        via: 'graphql-schema',
        patterns: ['**/*.graphql'],
      };

      const result = RelationConfigSchema.parse(config);

      expect(result.patterns).toEqual(['**/*.graphql']);
    });
  });

  describe('ImpactConfigSchema', () => {
    it('should accept valid full config', () => {
      const config = {
        repos: [
          {
            name: 'frontend',
            path: './frontend',
            type: 'angular',
            analyzers: ['ts-morph'],
          },
          {
            name: 'api',
            path: './api',
            type: 'graphql-node',
            analyzers: ['graphql-inspector'],
          },
        ],
        relations: [
          {
            from: 'frontend',
            to: 'api',
            via: 'graphql-schema',
          },
        ],
        output: {
          githubComment: true,
          githubCheck: true,
        },
      };

      const result = ImpactConfigSchema.parse(config);

      expect(result.repos).toHaveLength(2);
      expect(result.relations).toHaveLength(1);
    });

    it('should reject relations referencing non-existent repos', () => {
      const config = {
        repos: [
          {
            name: 'frontend',
            path: './frontend',
            type: 'angular',
            analyzers: ['ts-morph'],
          },
        ],
        relations: [
          {
            from: 'frontend',
            to: 'nonexistent',
            via: 'graphql-schema',
          },
        ],
      };

      expect(() => ImpactConfigSchema.parse(config)).toThrow();
    });

    it('should accept LLM config', () => {
      const config = {
        repos: [
          {
            name: 'frontend',
            path: './frontend',
            type: 'angular',
            analyzers: ['ts-morph'],
          },
        ],
        llm: {
          enabled: true,
          provider: 'claude',
          model: 'claude-3-5-sonnet-latest',
          secretsFilter: true,
        },
      };

      const result = ImpactConfigSchema.parse(config);

      expect(result.llm?.enabled).toBe(true);
      expect(result.llm?.provider).toBe('claude');
    });

    it('should use default values', () => {
      const config = {
        repos: [
          {
            name: 'frontend',
            path: './frontend',
            type: 'angular',
            analyzers: ['ts-morph'],
          },
        ],
      };

      const result = ImpactConfigSchema.parse(config);

      expect(result.relations).toEqual([]);
      expect(result.output.githubComment).toBe(true);
      expect(result.output.githubCheck).toBe(true);
    });
  });
});
