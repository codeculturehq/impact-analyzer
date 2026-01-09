import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, findConfig, ConfigLoadError, ConfigValidationError } from '../../src/config/loader.js';

const TEST_DIR = '/tmp/impact-analyzer-test';

describe('Config Loader', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('should load a valid YAML config', async () => {
      const configPath = join(TEST_DIR, 'impact.config.yaml');
      await writeFile(configPath, `
repos:
  - name: frontend
    path: ./frontend
    type: angular
    analyzers:
      - ts-morph

relations: []

output:
  githubComment: true
  githubCheck: true
`);

      const config = await loadConfig(configPath);

      expect(config.repos).toHaveLength(1);
      expect(config.repos[0].name).toBe('frontend');
      expect(config.repos[0].type).toBe('angular');
      expect(config.repos[0].analyzers).toContain('ts-morph');
    });

    it('should load a valid JSON config', async () => {
      const configPath = join(TEST_DIR, 'impact.config.json');
      await writeFile(configPath, JSON.stringify({
        repos: [
          {
            name: 'api',
            path: './api',
            type: 'graphql-node',
            analyzers: ['graphql-inspector'],
          },
        ],
        relations: [],
        output: {
          githubComment: true,
          githubCheck: false,
        },
      }));

      const config = await loadConfig(configPath);

      expect(config.repos).toHaveLength(1);
      expect(config.repos[0].name).toBe('api');
      expect(config.repos[0].type).toBe('graphql-node');
      expect(config.output.githubCheck).toBe(false);
    });

    it('should throw ConfigLoadError for missing file', async () => {
      const configPath = join(TEST_DIR, 'nonexistent.yaml');

      await expect(loadConfig(configPath)).rejects.toThrow(ConfigLoadError);
    });

    it('should throw ConfigValidationError for invalid config', async () => {
      const configPath = join(TEST_DIR, 'invalid.yaml');
      await writeFile(configPath, `
repos:
  - name: ""
    path: ./frontend
    type: invalid-type
    analyzers: []
`);

      await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError);
    });

    it('should validate relation references', async () => {
      const configPath = join(TEST_DIR, 'bad-relations.yaml');
      await writeFile(configPath, `
repos:
  - name: frontend
    path: ./frontend
    type: angular
    analyzers:
      - ts-morph

relations:
  - from: frontend
    to: nonexistent-repo
    via: graphql-schema

output:
  githubComment: true
  githubCheck: true
`);

      await expect(loadConfig(configPath)).rejects.toThrow(ConfigValidationError);
    });
  });

  describe('findConfig', () => {
    it('should find impact.config.yaml in directory', async () => {
      const configPath = join(TEST_DIR, 'impact.config.yaml');
      await writeFile(configPath, 'repos: []');

      const found = await findConfig(TEST_DIR);

      expect(found).toBe(configPath);
    });

    it('should find impact.config.json in directory', async () => {
      const configPath = join(TEST_DIR, 'impact.config.json');
      await writeFile(configPath, '{"repos": []}');

      const found = await findConfig(TEST_DIR);

      expect(found).toBe(configPath);
    });

    it('should return null when no config exists', async () => {
      const found = await findConfig(TEST_DIR);

      expect(found).toBeNull();
    });

    it('should prefer yaml over json', async () => {
      const yamlPath = join(TEST_DIR, 'impact.config.yaml');
      const jsonPath = join(TEST_DIR, 'impact.config.json');
      await writeFile(yamlPath, 'repos: []');
      await writeFile(jsonPath, '{"repos": []}');

      const found = await findConfig(TEST_DIR);

      expect(found).toBe(yamlPath);
    });
  });
});
