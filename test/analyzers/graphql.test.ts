import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { GraphQLAnalyzer } from '../../src/analyzers/graphql.js';
import type { RepoConfig } from '../../src/types/index.js';

// Use unique test directory with timestamp to avoid test isolation issues
const TEST_DIR = `/tmp/impact-graphql-test-${Date.now()}`;

describe('GraphQLAnalyzer', () => {
  let config: RepoConfig;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, 'src'), { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: TEST_DIR });
    execSync('git config user.email "test@test.com"', { cwd: TEST_DIR });
    execSync('git config user.name "Test"', { cwd: TEST_DIR });

    config = {
      name: 'api',
      path: TEST_DIR,
      type: 'graphql-node',
      analyzers: ['graphql-inspector'],
    };
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('analyze', () => {
    it('should return empty array when no GraphQL files changed', async () => {
      // Create initial commit with non-graphql file
      await writeFile(join(TEST_DIR, 'index.ts'), 'console.log("hello")');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Create a second commit with another non-graphql file
      await writeFile(join(TEST_DIR, 'other.ts'), 'console.log("other")');
      execSync('git add . && git commit -m "second"', { cwd: TEST_DIR });

      const analyzer = new GraphQLAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts).toEqual([]);
    });

    it('should detect schema file changes', async () => {
      // Create initial schema
      await writeFile(join(TEST_DIR, 'schema.graphql'), `
type Query {
  users: [User!]!
}

type User {
  id: ID!
  name: String!
}
`);
      execSync('git add . && git commit -m "initial schema"', { cwd: TEST_DIR });

      // Modify schema
      await writeFile(join(TEST_DIR, 'schema.graphql'), `
type Query {
  users: [User!]!
  user(id: ID!): User
}

type User {
  id: ID!
  name: String!
  email: String
}
`);
      execSync('git add . && git commit -m "add user query and email field"', { cwd: TEST_DIR });

      const analyzer = new GraphQLAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.file.includes('schema.graphql'))).toBe(true);
    }, 30000); // Increase timeout for graphql-inspector

    it('should detect resolver file changes', async () => {
      // Create initial commit
      await writeFile(join(TEST_DIR, 'schema.graphql'), 'type Query { hello: String }');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Add resolver
      await writeFile(join(TEST_DIR, 'src', 'user.resolver.ts'), `
import { Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class UserResolver {
  @Query('users')
  async getUsers() {
    return [];
  }
}
`);
      execSync('git add . && git commit -m "add user resolver"', { cwd: TEST_DIR });

      const analyzer = new GraphQLAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.component.includes('Resolver') || i.component.includes('user'))).toBe(true);
    });

    it('should detect .graphql query file changes', async () => {
      // Create initial commit
      await writeFile(join(TEST_DIR, 'schema.graphql'), 'type Query { hello: String }');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Create queries directory and add query file
      await mkdir(join(TEST_DIR, 'src', 'queries'), { recursive: true });
      await writeFile(join(TEST_DIR, 'src', 'queries', 'getUsers.graphql'), `
query GetUsers {
  users {
    id
    name
  }
}
`);
      execSync('git add . && git commit -m "add getUsers query"', { cwd: TEST_DIR });

      const analyzer = new GraphQLAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.component === 'GetUsers' || i.file.includes('getUsers'))).toBe(true);
    });
  });

  describe('name', () => {
    it('should return "graphql"', () => {
      const analyzer = new GraphQLAnalyzer(config, 'HEAD', 'HEAD');
      expect(analyzer.name).toBe('graphql');
    });
  });
});
