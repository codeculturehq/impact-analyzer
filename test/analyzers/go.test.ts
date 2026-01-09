import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { GoAnalyzer } from '../../src/analyzers/go.js';
import type { RepoConfig } from '../../src/types/index.js';

const TEST_DIR = '/tmp/impact-go-test';

describe('GoAnalyzer', () => {
  let config: RepoConfig;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: TEST_DIR });
    execSync('git config user.email "test@test.com"', { cwd: TEST_DIR });
    execSync('git config user.name "Test"', { cwd: TEST_DIR });

    config = {
      name: 'lambdas',
      path: TEST_DIR,
      type: 'go',
      analyzers: ['go-ast'],
    };
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('analyze', () => {
    it('should return empty array when no Go files changed', async () => {
      // Create initial commit with non-go file
      await writeFile(join(TEST_DIR, 'README.md'), '# Test');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      const analyzer = new GoAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts).toEqual([]);
    });

    it('should detect Lambda handler changes', async () => {
      // Create initial commit
      await writeFile(join(TEST_DIR, 'go.mod'), 'module test\n\ngo 1.21');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Add Lambda handler
      await writeFile(join(TEST_DIR, 'main.go'), `
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/lambda"
)

func HandleRequest(ctx context.Context, event map[string]interface{}) (string, error) {
    return "Hello", nil
}

func main() {
    lambda.Start(HandleRequest)
}
`);
      execSync('git add . && git commit -m "add handler"', { cwd: TEST_DIR });

      const analyzer = new GoAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.component.includes('Lambda') || i.component.includes('Handle'))).toBe(true);
    });

    it('should detect struct changes with json tags', async () => {
      // Create initial commit
      await writeFile(join(TEST_DIR, 'go.mod'), 'module test\n\ngo 1.21');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Add struct with json tags
      await writeFile(join(TEST_DIR, 'types.go'), `
package main

type User struct {
    ID   string \`json:"id"\`
    Name string \`json:"name"\`
}
`);
      execSync('git add . && git commit -m "add user struct"', { cwd: TEST_DIR });

      const analyzer = new GoAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.component.includes('Struct') && i.component.includes('User'))).toBe(true);
    });

    it('should detect go.mod changes', async () => {
      // Create initial commit
      await writeFile(join(TEST_DIR, 'go.mod'), 'module test\n\ngo 1.21');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Modify go.mod
      await writeFile(join(TEST_DIR, 'go.mod'), `module test

go 1.21

require github.com/aws/aws-lambda-go v1.41.0
`);
      execSync('git add . && git commit -m "add dependency"', { cwd: TEST_DIR });

      const analyzer = new GoAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.component === 'Go Dependencies')).toBe(true);
    });

    it('should detect SQS handler patterns', async () => {
      // Create initial commit
      await writeFile(join(TEST_DIR, 'go.mod'), 'module test\n\ngo 1.21');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Add SQS handler
      await writeFile(join(TEST_DIR, 'sqs_handler.go'), `
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/events"
)

func HandleSQSEvent(ctx context.Context, event events.SQSEvent) error {
    for _, record := range event.Records {
        // Process message
        _ = record.Body
    }
    return nil
}
`);
      execSync('git add . && git commit -m "add sqs handler"', { cwd: TEST_DIR });

      const analyzer = new GoAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.component.includes('SQS'))).toBe(true);
    });

    it('should detect API Gateway handler patterns', async () => {
      // Create initial commit
      await writeFile(join(TEST_DIR, 'go.mod'), 'module test\n\ngo 1.21');
      execSync('git add . && git commit -m "initial"', { cwd: TEST_DIR });

      // Add API handler
      await writeFile(join(TEST_DIR, 'api_handler.go'), `
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/events"
)

func HandleAPIRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    return events.APIGatewayProxyResponse{
        StatusCode: 200,
        Body:       "OK",
    }, nil
}
`);
      execSync('git add . && git commit -m "add api handler"', { cwd: TEST_DIR });

      const analyzer = new GoAnalyzer(config, 'HEAD~1', 'HEAD');
      const impacts = await analyzer.analyze();

      expect(impacts.length).toBeGreaterThan(0);
      expect(impacts.some(i => i.component.includes('API Handler'))).toBe(true);
    });
  });

  describe('name', () => {
    it('should return "go"', () => {
      const analyzer = new GoAnalyzer(config, 'HEAD', 'HEAD');
      expect(analyzer.name).toBe('go');
    });
  });
});
