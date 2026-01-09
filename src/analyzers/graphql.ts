import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { BaseAnalyzer } from './base.js';
import type { ImpactItem, RepoConfig } from '../types/index.js';

interface SchemaChange {
  type: 'FIELD_ADDED' | 'FIELD_REMOVED' | 'FIELD_CHANGED' | 'TYPE_ADDED' | 'TYPE_REMOVED' | 'TYPE_CHANGED' | 'BREAKING' | 'DANGEROUS' | 'NON_BREAKING';
  message: string;
  path?: string;
  criticality: 'BREAKING' | 'DANGEROUS' | 'NON_BREAKING';
}

/**
 * Analyzer for GraphQL schemas using graphql-inspector
 */
export class GraphQLAnalyzer extends BaseAnalyzer {
  private schemaPath: string;

  constructor(
    config: RepoConfig,
    baseRef: string,
    headRef: string
  ) {
    super(config, baseRef, headRef);
    // Default schema path, can be overridden via config
    this.schemaPath = this.findSchemaPath();
  }

  get name(): string {
    return 'graphql';
  }

  async analyze(): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    // Get changed files
    const changedFiles = await this.getChangedFiles();

    // Check if any GraphQL-related files changed
    const graphqlFiles = this.filterByExtension(changedFiles, '.graphql', '.gql');
    const schemaFiles = changedFiles.filter(f =>
      f.includes('schema') || f.includes('typeDefs') || f.endsWith('.graphql')
    );
    const resolverFiles = changedFiles.filter(f =>
      f.includes('resolver') || f.includes('Resolver')
    );

    if (graphqlFiles.length === 0 && schemaFiles.length === 0 && resolverFiles.length === 0) {
      return [];
    }

    // Analyze schema changes
    const schemaChanges = await this.analyzeSchemaChanges();

    for (const change of schemaChanges) {
      const reasonType = change.criticality === 'BREAKING' ? 'schema' : 'direct';
      impacts.push(this.createImpact(
        change.path || 'GraphQL Schema',
        this.schemaPath,
        reasonType,
        'schema-diff',
        `[${change.criticality}] ${change.message}`
      ));
    }

    // Fallback: if no schema changes detected but schema files changed, create basic impact
    if (schemaChanges.length === 0 && schemaFiles.length > 0) {
      for (const schemaFile of schemaFiles) {
        if (schemaFile.endsWith('.graphql') || schemaFile.endsWith('.gql')) {
          impacts.push(this.createImpact(
            'GraphQL Schema',
            schemaFile,
            'schema',
            schemaFile,
            'GraphQL schema file was modified'
          ));
        }
      }
    }

    // Analyze resolver changes
    const resolverImpacts = await this.analyzeResolverChanges(changedFiles);
    impacts.push(...resolverImpacts);

    // Analyze query/mutation file changes
    const queryImpacts = await this.analyzeQueryChanges(changedFiles);
    impacts.push(...queryImpacts);

    return this.deduplicateImpacts(impacts);
  }

  /**
   * Find the schema file path
   */
  private findSchemaPath(): string {
    const candidates = [
      'schema.graphql',
      'src/schema.graphql',
      'src/graphql/schema.graphql',
      'graphql/schema.graphql',
      'src/schema/schema.graphql',
      'schema/schema.graphql',
    ];

    for (const candidate of candidates) {
      const fullPath = path.join(this.repoPath, candidate);
      if (existsSync(fullPath)) {
        return candidate;
      }
    }

    return 'schema.graphql';
  }

  /**
   * Analyze schema changes using graphql-inspector
   */
  private async analyzeSchemaChanges(): Promise<SchemaChange[]> {
    const changes: SchemaChange[] = [];

    try {
      // Get old schema from base ref
      const oldSchema = await this.getFileAtRef(this.schemaPath, this.baseRef);
      if (!oldSchema) {
        return [];
      }

      // Get new schema from head ref
      const newSchema = await this.getFileAtRef(this.schemaPath, this.headRef);
      if (!newSchema) {
        return [];
      }

      // Write temp files for comparison (use Node.js fs to handle large schemas)
      const tempDir = `/tmp/impact-graphql-${Date.now()}`;
      await mkdir(tempDir, { recursive: true });

      const oldPath = `${tempDir}/old.graphql`;
      const newPath = `${tempDir}/new.graphql`;

      await writeFile(oldPath, oldSchema, 'utf-8');
      await writeFile(newPath, newSchema, 'utf-8');

      // Run graphql-inspector diff
      try {
        const { stdout } = await execa('npx', [
          'graphql-inspector',
          'diff',
          oldPath,
          newPath,
          '--format', 'json'
        ], { cwd: this.repoPath, reject: false });

        if (stdout) {
          const result = JSON.parse(stdout);
          if (Array.isArray(result)) {
            for (const change of result) {
              changes.push({
                type: change.type || 'TYPE_CHANGED',
                message: change.message || 'Schema changed',
                path: change.path,
                criticality: change.criticality?.level || 'NON_BREAKING',
              });
            }
          }
        }
      } catch {
        // graphql-inspector not available, use simple diff
        if (oldSchema !== newSchema) {
          changes.push({
            type: 'TYPE_CHANGED',
            message: 'GraphQL schema was modified',
            path: this.schemaPath,
            criticality: 'DANGEROUS',
          });
        }
      }

      // Cleanup
      await rm(tempDir, { recursive: true, force: true });

    } catch (error) {
      console.warn(`GraphQL schema analysis failed: ${error}`);
    }

    return changes;
  }

  /**
   * Get file content at a specific git ref
   */
  private async getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    try {
      const { stdout } = await execa(
        'git',
        ['show', `${ref}:${filePath}`],
        { cwd: this.repoPath }
      );
      return stdout;
    } catch {
      return null;
    }
  }

  /**
   * Analyze resolver file changes
   */
  private async analyzeResolverChanges(changedFiles: string[]): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    const resolverFiles = changedFiles.filter(f =>
      f.includes('resolver') || f.includes('Resolver')
    );

    for (const file of resolverFiles) {
      // Extract resolver name from file path
      const resolverName = path.basename(file, path.extname(file))
        .replace(/\.resolver$/, '')
        .replace(/Resolver$/, '');

      impacts.push(this.createImpact(
        `${resolverName} Resolver`,
        file,
        'direct',
        file,
        `Resolver ${resolverName} was modified`
      ));

      // Try to find which queries/mutations this resolver handles
      const diff = await this.getFileDiff(file);
      const queryMatches = diff.match(/@Query\(['"](\w+)['"]\)|@Query\(\)/g);
      const mutationMatches = diff.match(/@Mutation\(['"](\w+)['"]\)|@Mutation\(\)/g);

      if (queryMatches) {
        for (const match of queryMatches) {
          const queryName = match.match(/['"](\w+)['"]/)?.[1] || 'unknown';
          impacts.push(this.createImpact(
            `Query: ${queryName}`,
            file,
            'direct',
            file,
            `Query ${queryName} resolver was modified`
          ));
        }
      }

      if (mutationMatches) {
        for (const match of mutationMatches) {
          const mutationName = match.match(/['"](\w+)['"]/)?.[1] || 'unknown';
          impacts.push(this.createImpact(
            `Mutation: ${mutationName}`,
            file,
            'direct',
            file,
            `Mutation ${mutationName} resolver was modified`
          ));
        }
      }
    }

    return impacts;
  }

  /**
   * Analyze .graphql query/mutation file changes
   */
  private async analyzeQueryChanges(changedFiles: string[]): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    const queryFiles = this.filterByExtension(changedFiles, '.graphql', '.gql');

    for (const file of queryFiles) {
      // Skip schema files
      if (file.includes('schema')) continue;

      const content = await this.readFile(file);
      if (!content) continue;

      // Parse operation names
      const operationMatches = content.matchAll(/(?:query|mutation|subscription)\s+(\w+)/g);

      for (const match of operationMatches) {
        const operationName = match[1];
        if (operationName) {
          impacts.push(this.createImpact(
            operationName,
            file,
            'direct',
            file,
            `GraphQL operation ${operationName} was modified`
          ));
        }
      }

      // If no named operations, create generic impact
      if (!content.match(/(?:query|mutation|subscription)\s+\w+/)) {
        impacts.push(this.createImpact(
          path.basename(file),
          file,
          'direct',
          file,
          `GraphQL file was modified`
        ));
      }
    }

    return impacts;
  }
}
