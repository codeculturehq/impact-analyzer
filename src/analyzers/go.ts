import path from 'node:path';
import { BaseAnalyzer } from './base.js';
import type { ImpactItem, RepoConfig } from '../types/index.js';

interface GoFunction {
  name: string;
  file: string;
  isHandler: boolean;
  package: string;
}

interface GoStruct {
  name: string;
  file: string;
  package: string;
}

/**
 * Analyzer for Go projects (Lambda functions, services)
 */
export class GoAnalyzer extends BaseAnalyzer {
  private functions: Map<string, GoFunction> = new Map();
  private structs: Map<string, GoStruct> = new Map();

  constructor(
    config: RepoConfig,
    baseRef: string,
    headRef: string
  ) {
    super(config, baseRef, headRef);
  }

  get name(): string {
    return 'go';
  }

  async analyze(): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    // Get changed files
    const changedFiles = await this.getChangedFiles();

    // Analyze go.mod changes first (affects all functions)
    const goModFiles = changedFiles.filter(f => f.endsWith('go.mod') || f.endsWith('go.sum'));
    for (const file of goModFiles) {
      impacts.push(this.createImpact(
        'Go Dependencies',
        file,
        'dependency',
        file,
        `Go module dependencies changed - may affect all functions`
      ));
    }

    // Filter Go files
    const goFiles = this.filterByExtension(changedFiles, '.go');
    if (goFiles.length === 0) {
      return this.deduplicateImpacts(impacts);
    }

    // Build function and struct maps
    await this.buildMaps(goFiles);

    // Analyze each changed file
    for (const file of goFiles) {
      const fileImpacts = await this.analyzeGoFile(file);
      impacts.push(...fileImpacts);
    }

    return this.deduplicateImpacts(impacts);
  }

  /**
   * Build maps of functions and structs from changed files
   */
  private async buildMaps(files: string[]): Promise<void> {
    for (const file of files) {
      const content = await this.readFile(file);
      if (!content) continue;

      const packageName = this.extractPackageName(content);

      // Extract functions
      const funcMatches = content.matchAll(/func\s+(?:\([\w\s*]+\)\s+)?(\w+)\s*\(/g);
      for (const match of funcMatches) {
        const funcName = match[1];
        if (!funcName) continue;
        const isHandler = this.isLambdaHandler(funcName, content);

        this.functions.set(`${packageName}.${funcName}`, {
          name: funcName,
          file,
          isHandler,
          package: packageName,
        });
      }

      // Extract structs
      const structMatches = content.matchAll(/type\s+(\w+)\s+struct\s*\{/g);
      for (const match of structMatches) {
        const structName = match[1];
        if (!structName) continue;
        this.structs.set(`${packageName}.${structName}`, {
          name: structName,
          file,
          package: packageName,
        });
      }
    }
  }

  /**
   * Extract package name from Go file content
   */
  private extractPackageName(content: string): string {
    const match = content.match(/^package\s+(\w+)/m);
    return match?.[1] ?? 'main';
  }

  /**
   * Check if a function is a Lambda handler
   */
  private isLambdaHandler(funcName: string, content: string): boolean {
    // Common Lambda handler patterns
    const handlerPatterns = [
      /lambda\.Start\s*\(\s*\w*\.?\s*/.source + funcName,
      /lambda\.StartWithOptions\s*\(\s*\w*\.?\s*/.source + funcName,
      /Handler\s*[:=]\s*/.source + funcName,
      funcName + /\s*\(\s*ctx\s+context\.Context/.source,
    ];

    for (const pattern of handlerPatterns) {
      if (new RegExp(pattern).test(content)) {
        return true;
      }
    }

    // Check if function name suggests it's a handler
    return /^(Handle|Process|Execute|Run|Handler)/.test(funcName);
  }

  /**
   * Analyze a single Go file
   */
  private async analyzeGoFile(file: string): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];
    const diff = await this.getFileDiff(file);
    const content = await this.readFile(file);

    if (!content) return impacts;

    // Check for handler functions
    for (const [_key, func] of this.functions) {
      if (func.file === file && func.isHandler) {
        impacts.push(this.createImpact(
          `Lambda: ${func.name}`,
          file,
          'direct',
          file,
          `Lambda handler ${func.name} was modified`
        ));
      }
    }

    // Check for struct changes (affects serialization)
    for (const [_key, struct] of this.structs) {
      if (struct.file === file) {
        // Check if struct has json tags (API contract)
        const structRegex = new RegExp(`type\\s+${struct.name}\\s+struct\\s*\\{[^}]+\\}`, 's');
        const structMatch = content.match(structRegex);

        if (structMatch && structMatch[0].includes('json:')) {
          impacts.push(this.createImpact(
            `Struct: ${struct.name}`,
            file,
            'schema',
            file,
            `Data structure ${struct.name} was modified - may affect API contract`
          ));
        }
      }
    }

    // Check for interface changes
    const interfaceMatches = content.matchAll(/type\s+(\w+)\s+interface\s*\{/g);
    for (const match of interfaceMatches) {
      const interfaceName = match[1];
      impacts.push(this.createImpact(
        `Interface: ${interfaceName}`,
        file,
        'direct',
        file,
        `Interface ${interfaceName} was modified`
      ));
    }

    // Check for SQS handler patterns
    if (content.includes('events.SQSEvent') || content.includes('sqs.')) {
      impacts.push(this.createImpact(
        `SQS Handler: ${path.basename(file, '.go')}`,
        file,
        'direct',
        file,
        `SQS message handler was modified`
      ));
    }

    // Check for API Gateway handler patterns
    if (content.includes('events.APIGatewayProxyRequest') || content.includes('events.APIGatewayV2HTTPRequest')) {
      impacts.push(this.createImpact(
        `API Handler: ${path.basename(file, '.go')}`,
        file,
        'direct',
        file,
        `API Gateway handler was modified`
      ));
    }

    // Check for environment variable usage changes
    const envMatches = diff.match(/os\.Getenv\s*\(\s*["'](\w+)["']\s*\)/g);
    if (envMatches) {
      impacts.push(this.createImpact(
        `Environment Config`,
        file,
        'config',
        file,
        `Environment variable usage changed in ${path.basename(file)}`
      ));
    }

    return impacts;
  }
}
