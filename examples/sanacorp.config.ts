/**
 * Sanacorp Impact Analyzer Configuration
 *
 * This config analyzes the cross-repo impact between:
 * - Frontend (Angular)
 * - API (GraphQL)
 * - Lambda Functions (Go)
 */
import { defineConfig } from '../src/config/schema.js';

export default defineConfig({
  repos: [
    // Angular Frontend
    {
      name: 'frontend',
      path: '../sanacorp-frontend',
      type: 'angular',
      analyzers: ['ts-morph', 'nx'],
      includePaths: ['src/app', 'libs'],
      excludePaths: ['**/*.spec.ts', '**/*.test.ts', '**/node_modules'],
    },
    // GraphQL API
    {
      name: 'api',
      path: '../sanacorp-api',
      type: 'graphql-node',
      analyzers: ['ts-morph', 'graphql-inspector'],
      includePaths: ['src', 'graphql'],
      excludePaths: ['**/*.spec.ts', '**/*.test.ts', '**/node_modules'],
    },
    // Go Lambda Functions
    {
      name: 'lambdas',
      path: '../sanacorp-lambdas',
      type: 'go',
      analyzers: ['go-ast'],
      includePaths: ['cmd', 'internal', 'pkg'],
      excludePaths: ['**/*_test.go', '**/vendor'],
    },
  ],

  relations: [
    // GraphQL Schema changes affect Frontend
    {
      from: 'api',
      to: 'frontend',
      via: 'graphql-schema',
      patterns: [
        'schema.graphql',
        '**/*.graphql',
        '**/resolvers/**/*.ts',
      ],
    },
    // GraphQL Schema changes affect Lambdas
    {
      from: 'api',
      to: 'lambdas',
      via: 'graphql-schema',
      patterns: [
        'schema.graphql',
        '**/*.graphql',
      ],
    },
    // SQS message contracts between API and Lambdas
    {
      from: 'api',
      to: 'lambdas',
      via: 'sqs',
      patterns: [
        '**/sqs/**/*.ts',
        '**/messages/**/*.ts',
        '**/events/**/*.ts',
      ],
    },
    // SQS message contracts from Lambdas to API
    {
      from: 'lambdas',
      to: 'api',
      via: 'sqs',
      patterns: [
        '**/sqs/**/*.go',
        '**/messages/**/*.go',
        '**/events/**/*.go',
      ],
    },
    // Shared types between API and Frontend
    {
      from: 'api',
      to: 'frontend',
      via: 'shared-types',
      patterns: [
        '**/types/**/*.ts',
        '**/dto/**/*.ts',
        '**/interfaces/**/*.ts',
      ],
    },
    // API calls from Frontend to API
    {
      from: 'frontend',
      to: 'api',
      via: 'api-call',
      patterns: [
        '**/services/**/*.service.ts',
        '**/*.graphql',
        '**/queries/**/*.ts',
        '**/mutations/**/*.ts',
      ],
    },
    // Shared npm packages
    {
      from: 'api',
      to: 'frontend',
      via: 'npm-package',
      patterns: [
        'package.json',
        '**/shared/**/*',
      ],
    },
  ],

  output: {
    githubComment: true,
    githubCheck: true,
    slack: {
      channel: '#sanacorp-ci',
      // Webhook URL should be provided via SLACK_WEBHOOK_URL env var
    },
  },

  llm: {
    enabled: true,
    provider: 'claude',
    model: 'claude-3-5-sonnet-latest',
    maxTokens: 2048,
    secretsFilter: true,
  },
});
