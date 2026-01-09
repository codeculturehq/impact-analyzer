import { describe, it, expect } from 'vitest';
import { CrossRepoAnalyzer } from '../../src/analyzers/cross-repo.js';
import type { RelationConfig, ImpactItem } from '../../src/types/index.js';

function createImpact(
  component: string,
  file: string,
  reasonType: ImpactItem['reasons'][0]['type'],
  source: string,
  description: string,
  repo: string = 'test-repo'
): ImpactItem {
  return {
    component,
    repo,
    file,
    reasons: [{ type: reasonType, source, description }],
  };
}

describe('CrossRepoAnalyzer', () => {
  describe('graphql-schema relation', () => {
    it('should detect cross-repo impact when API schema changes', () => {
      const relations: RelationConfig[] = [
        { from: 'api', to: 'frontend', via: 'graphql-schema' },
      ];

      const repoImpacts = [
        {
          name: 'api',
          impacts: [
            createImpact('Query: getUsers', 'schema.graphql', 'schema', 'schema.graphql', 'GraphQL schema modified', 'api'),
          ],
        },
        {
          name: 'frontend',
          impacts: [
            createImpact('UserList', 'src/queries/getUsers.graphql', 'direct', 'getUsers.graphql', 'Query file modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
      expect(crossImpacts[0].sourceRepo).toBe('api');
      expect(crossImpacts[0].targetRepo).toBe('frontend');
      expect(crossImpacts[0].relation).toBe('graphql-schema');
      expect(crossImpacts[0].targetComponents).toContain('UserList');
    });

    it('should not detect cross-repo impact when no schema changes', () => {
      const relations: RelationConfig[] = [
        { from: 'api', to: 'frontend', via: 'graphql-schema' },
      ];

      const repoImpacts = [
        {
          name: 'api',
          impacts: [
            createImpact('UserService', 'src/services/user.ts', 'direct', 'user.ts', 'Service modified', 'api'),
          ],
        },
        {
          name: 'frontend',
          impacts: [
            createImpact('UserList', 'src/components/UserList.tsx', 'direct', 'UserList.tsx', 'Component modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBe(0);
    });
  });

  describe('sqs relation', () => {
    it('should detect cross-repo impact when SQS handler changes', () => {
      const relations: RelationConfig[] = [
        { from: 'lambdas', to: 'api', via: 'sqs' },
      ];

      const repoImpacts = [
        {
          name: 'lambdas',
          impacts: [
            createImpact('SQS Handler: email_processor', 'email_processor.go', 'direct', 'email_processor.go', 'SQS message handler was modified', 'lambdas'),
          ],
        },
        {
          name: 'api',
          impacts: [
            createImpact('SQS Handler: notification', 'src/sqs/notification.ts', 'direct', 'notification.ts', 'SQS handler modified', 'api'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
      expect(crossImpacts[0].sourceRepo).toBe('lambdas');
      expect(crossImpacts[0].targetRepo).toBe('api');
      expect(crossImpacts[0].relation).toBe('sqs');
    });
  });

  describe('shared-types relation', () => {
    it('should detect cross-repo impact when shared types change', () => {
      const relations: RelationConfig[] = [
        { from: 'shared', to: 'frontend', via: 'shared-types' },
      ];

      const repoImpacts = [
        {
          name: 'shared',
          impacts: [
            createImpact('UserType', 'src/types/user.ts', 'direct', 'user.ts', 'Type definition modified', 'shared'),
          ],
        },
        {
          name: 'frontend',
          impacts: [
            createImpact('UserComponent', 'src/components/User.tsx', 'direct', 'User.tsx', 'Component modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
      expect(crossImpacts[0].sourceRepo).toBe('shared');
      expect(crossImpacts[0].targetRepo).toBe('frontend');
      expect(crossImpacts[0].relation).toBe('shared-types');
    });

    it('should detect Go struct changes as shared types', () => {
      const relations: RelationConfig[] = [
        { from: 'lambdas', to: 'api', via: 'shared-types' },
      ];

      const repoImpacts = [
        {
          name: 'lambdas',
          impacts: [
            createImpact('Struct: User', 'types.go', 'schema', 'types.go', 'Data structure User was modified', 'lambdas'),
          ],
        },
        {
          name: 'api',
          impacts: [
            createImpact('UserHandler', 'handlers/user.go', 'direct', 'user.go', 'Handler modified', 'api'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
      expect(crossImpacts[0].relation).toBe('shared-types');
    });
  });

  describe('api-call relation', () => {
    it('should detect cross-repo impact when API handler changes', () => {
      const relations: RelationConfig[] = [
        { from: 'api', to: 'frontend', via: 'api-call' },
      ];

      const repoImpacts = [
        {
          name: 'api',
          impacts: [
            createImpact('API Handler: users', 'api_handler.go', 'direct', 'api_handler.go', 'API Gateway handler was modified', 'api'),
          ],
        },
        {
          name: 'frontend',
          impacts: [
            createImpact('UserService', 'src/services/user.service.ts', 'direct', 'user.service.ts', 'Service modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
      expect(crossImpacts[0].sourceRepo).toBe('api');
      expect(crossImpacts[0].targetRepo).toBe('frontend');
      expect(crossImpacts[0].relation).toBe('api-call');
    });
  });

  describe('npm-package relation', () => {
    it('should detect cross-repo impact when dependencies change', () => {
      const relations: RelationConfig[] = [
        { from: 'shared-lib', to: 'frontend', via: 'npm-package' },
      ];

      const repoImpacts = [
        {
          name: 'shared-lib',
          impacts: [
            createImpact('Dependencies', 'package.json', 'dependency', 'package.json', 'Dependencies changed', 'shared-lib'),
          ],
        },
        {
          name: 'frontend',
          impacts: [
            createImpact('App', 'src/App.tsx', 'direct', 'App.tsx', 'Component modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
      expect(crossImpacts[0].relation).toBe('npm-package');
    });

    it('should detect Go module changes', () => {
      const relations: RelationConfig[] = [
        { from: 'lambdas', to: 'api', via: 'npm-package' },
      ];

      const repoImpacts = [
        {
          name: 'lambdas',
          impacts: [
            createImpact('Go Dependencies', 'go.mod', 'dependency', 'go.mod', 'Go module dependencies changed', 'lambdas'),
          ],
        },
        {
          name: 'api',
          impacts: [
            createImpact('Handler', 'main.go', 'direct', 'main.go', 'Handler modified', 'api'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate cross-repo impacts', () => {
      const relations: RelationConfig[] = [
        { from: 'api', to: 'frontend', via: 'graphql-schema' },
      ];

      const repoImpacts = [
        {
          name: 'api',
          impacts: [
            createImpact('Query: getUsers', 'schema.graphql', 'schema', 'schema.graphql', 'Schema modified', 'api'),
            createImpact('Mutation: createUser', 'schema.graphql', 'schema', 'schema.graphql', 'Schema modified', 'api'),
          ],
        },
        {
          name: 'frontend',
          impacts: [
            createImpact('UserList', 'src/queries/getUsers.graphql', 'direct', 'getUsers.graphql', 'Query modified', 'frontend'),
            createImpact('UserForm', 'src/queries/createUser.graphql', 'direct', 'createUser.graphql', 'Mutation modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      // Should have separate impacts for each source component
      expect(crossImpacts.length).toBe(2);

      // Each impact should have all target components
      for (const impact of crossImpacts) {
        expect(impact.targetComponents.length).toBeGreaterThan(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should return empty array when no relations defined', () => {
      const relations: RelationConfig[] = [];
      const repoImpacts = [
        {
          name: 'api',
          impacts: [
            createImpact('Handler', 'handler.go', 'direct', 'handler.go', 'Modified', 'api'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts).toEqual([]);
    });

    it('should return empty array when source repo not found', () => {
      const relations: RelationConfig[] = [
        { from: 'nonexistent', to: 'frontend', via: 'graphql-schema' },
      ];

      const repoImpacts = [
        {
          name: 'frontend',
          impacts: [
            createImpact('Component', 'Component.tsx', 'direct', 'Component.tsx', 'Modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts).toEqual([]);
    });

    it('should return empty array when target repo not found', () => {
      const relations: RelationConfig[] = [
        { from: 'api', to: 'nonexistent', via: 'graphql-schema' },
      ];

      const repoImpacts = [
        {
          name: 'api',
          impacts: [
            createImpact('Schema', 'schema.graphql', 'schema', 'schema.graphql', 'Modified', 'api'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts).toEqual([]);
    });

    it('should return empty array when no impacts in repos', () => {
      const relations: RelationConfig[] = [
        { from: 'api', to: 'frontend', via: 'graphql-schema' },
      ];

      const repoImpacts = [
        { name: 'api', impacts: [] },
        { name: 'frontend', impacts: [] },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts).toEqual([]);
    });
  });

  describe('pattern matching', () => {
    it('should match patterns in graphql-schema relation', () => {
      const relations: RelationConfig[] = [
        {
          from: 'api',
          to: 'frontend',
          via: 'graphql-schema',
          patterns: ['**/*.graphql'],
        },
      ];

      const repoImpacts = [
        {
          name: 'api',
          impacts: [
            createImpact('Schema', 'schema.graphql', 'schema', 'schema.graphql', 'Schema modified', 'api'),
          ],
        },
        {
          name: 'frontend',
          impacts: [
            createImpact('Query', 'src/graphql/queries/users.graphql', 'direct', 'users.graphql', 'Query modified', 'frontend'),
          ],
        },
      ];

      const analyzer = new CrossRepoAnalyzer(relations, repoImpacts);
      const crossImpacts = analyzer.analyze();

      expect(crossImpacts.length).toBeGreaterThan(0);
      expect(crossImpacts[0].targetComponents).toContain('Query');
    });
  });
});
