import type {
  RelationConfig,
  ImpactItem,
  CrossRepoImpact,
} from '../types/index.js';

interface RepoImpacts {
  name: string;
  impacts: ImpactItem[];
}

/**
 * Analyzer for detecting cross-repository impacts based on configured relations
 */
export class CrossRepoAnalyzer {
  constructor(
    private readonly relations: RelationConfig[],
    private readonly repoImpacts: RepoImpacts[]
  ) {}

  /**
   * Analyze cross-repo impacts based on the configured relations
   */
  analyze(): CrossRepoImpact[] {
    const crossImpacts: CrossRepoImpact[] = [];

    for (const relation of this.relations) {
      const impacts = this.analyzeRelation(relation);
      crossImpacts.push(...impacts);
    }

    return this.deduplicateCrossImpacts(crossImpacts);
  }

  /**
   * Analyze a single relation for cross-repo impacts
   */
  private analyzeRelation(relation: RelationConfig): CrossRepoImpact[] {
    const sourceRepo = this.repoImpacts.find(r => r.name === relation.from);
    const targetRepo = this.repoImpacts.find(r => r.name === relation.to);

    if (!sourceRepo || !targetRepo) {
      return [];
    }

    switch (relation.via) {
      case 'graphql-schema':
        return this.analyzeGraphQLRelation(sourceRepo, targetRepo, relation);
      case 'sqs':
        return this.analyzeSQSRelation(sourceRepo, targetRepo, relation);
      case 'shared-types':
        return this.analyzeSharedTypesRelation(sourceRepo, targetRepo, relation);
      case 'api-call':
        return this.analyzeAPICallRelation(sourceRepo, targetRepo, relation);
      case 'npm-package':
        return this.analyzeNpmPackageRelation(sourceRepo, targetRepo, relation);
      default:
        return [];
    }
  }

  /**
   * Analyze GraphQL schema relations
   * When API schema changes, find Frontend components that might use those types
   */
  private analyzeGraphQLRelation(
    sourceRepo: RepoImpacts,
    targetRepo: RepoImpacts,
    relation: RelationConfig
  ): CrossRepoImpact[] {
    const impacts: CrossRepoImpact[] = [];

    // Find schema-related impacts in source repo
    const schemaImpacts = sourceRepo.impacts.filter(
      i => i.reasons.some(r => r.type === 'schema') ||
           i.file.endsWith('.graphql') ||
           i.file.endsWith('.gql') ||
           i.component.includes('Query') ||
           i.component.includes('Mutation')
    );

    if (schemaImpacts.length === 0) {
      return [];
    }

    // Find target components that use GraphQL
    const targetComponents = this.findGraphQLConsumers(targetRepo, relation.patterns);

    if (targetComponents.length > 0) {
      for (const sourceImpact of schemaImpacts) {
        impacts.push({
          sourceRepo: sourceRepo.name,
          sourceComponent: sourceImpact.component,
          targetRepo: targetRepo.name,
          targetComponents,
          relation: 'graphql-schema',
        });
      }
    }

    return impacts;
  }

  /**
   * Find components in target repo that consume GraphQL
   */
  private findGraphQLConsumers(repo: RepoImpacts, patterns?: string[]): string[] {
    const consumers: string[] = [];

    // Look for GraphQL-related files in target repo impacts
    for (const impact of repo.impacts) {
      if (
        impact.file.endsWith('.graphql') ||
        impact.file.endsWith('.gql') ||
        impact.file.includes('query') ||
        impact.file.includes('mutation') ||
        impact.file.includes('apollo') ||
        impact.file.includes('graphql')
      ) {
        consumers.push(impact.component);
      }

      // Check if patterns match
      if (patterns) {
        for (const pattern of patterns) {
          if (this.matchesPattern(impact.file, pattern)) {
            consumers.push(impact.component);
          }
        }
      }
    }

    return [...new Set(consumers)];
  }

  /**
   * Analyze SQS relations
   * When a Lambda changes SQS handling, flag related consumers/producers
   */
  private analyzeSQSRelation(
    sourceRepo: RepoImpacts,
    targetRepo: RepoImpacts,
    _relation: RelationConfig
  ): CrossRepoImpact[] {
    const impacts: CrossRepoImpact[] = [];

    // Find SQS-related impacts in source repo
    const sqsImpacts = sourceRepo.impacts.filter(
      i => i.component.includes('SQS') ||
           i.reasons.some(r => r.description.toLowerCase().includes('sqs'))
    );

    if (sqsImpacts.length === 0) {
      return [];
    }

    // Find target components that interact with SQS
    const targetComponents = this.findSQSComponents(targetRepo);

    if (targetComponents.length > 0) {
      for (const sourceImpact of sqsImpacts) {
        impacts.push({
          sourceRepo: sourceRepo.name,
          sourceComponent: sourceImpact.component,
          targetRepo: targetRepo.name,
          targetComponents,
          relation: 'sqs',
        });
      }
    }

    return impacts;
  }

  /**
   * Find components that interact with SQS
   */
  private findSQSComponents(repo: RepoImpacts): string[] {
    return repo.impacts
      .filter(i =>
        i.component.includes('SQS') ||
        i.reasons.some(r => r.description.toLowerCase().includes('sqs'))
      )
      .map(i => i.component);
  }

  /**
   * Analyze shared types relations
   * When shared types change, flag all repos using them
   */
  private analyzeSharedTypesRelation(
    sourceRepo: RepoImpacts,
    targetRepo: RepoImpacts,
    _relation: RelationConfig
  ): CrossRepoImpact[] {
    const impacts: CrossRepoImpact[] = [];

    // Find type-related impacts in source repo
    const typeImpacts = sourceRepo.impacts.filter(
      i => i.file.includes('types') ||
           i.file.includes('interfaces') ||
           i.file.includes('models') ||
           i.component.includes('Type') ||
           i.component.includes('Interface') ||
           i.component.includes('Struct')
    );

    if (typeImpacts.length === 0) {
      return [];
    }

    // Any impact in target repo could be affected by shared type changes
    const targetComponents = targetRepo.impacts.map(i => i.component);

    if (targetComponents.length > 0) {
      for (const sourceImpact of typeImpacts) {
        impacts.push({
          sourceRepo: sourceRepo.name,
          sourceComponent: sourceImpact.component,
          targetRepo: targetRepo.name,
          targetComponents: [...new Set(targetComponents)],
          relation: 'shared-types',
        });
      }
    }

    return impacts;
  }

  /**
   * Analyze API call relations
   * When API endpoints change, flag clients making those calls
   */
  private analyzeAPICallRelation(
    sourceRepo: RepoImpacts,
    targetRepo: RepoImpacts,
    _relation: RelationConfig
  ): CrossRepoImpact[] {
    const impacts: CrossRepoImpact[] = [];

    // Find API-related impacts in source repo
    const apiImpacts = sourceRepo.impacts.filter(
      i => i.component.includes('API') ||
           i.component.includes('Handler') ||
           i.component.includes('Controller') ||
           i.component.includes('Endpoint') ||
           i.file.includes('controller') ||
           i.file.includes('handler') ||
           i.file.includes('routes')
    );

    if (apiImpacts.length === 0) {
      return [];
    }

    // Find target components that make API calls (services, data fetching)
    const targetComponents = targetRepo.impacts
      .filter(i =>
        i.file.includes('service') ||
        i.file.includes('api') ||
        i.file.includes('http') ||
        i.file.includes('fetch') ||
        i.component.includes('Service')
      )
      .map(i => i.component);

    if (targetComponents.length > 0) {
      for (const sourceImpact of apiImpacts) {
        impacts.push({
          sourceRepo: sourceRepo.name,
          sourceComponent: sourceImpact.component,
          targetRepo: targetRepo.name,
          targetComponents: [...new Set(targetComponents)],
          relation: 'api-call',
        });
      }
    }

    return impacts;
  }

  /**
   * Analyze npm package relations
   * When a shared npm package changes, flag dependent repos
   */
  private analyzeNpmPackageRelation(
    sourceRepo: RepoImpacts,
    targetRepo: RepoImpacts,
    _relation: RelationConfig
  ): CrossRepoImpact[] {
    const impacts: CrossRepoImpact[] = [];

    // Find dependency-related impacts in source repo
    const depImpacts = sourceRepo.impacts.filter(
      i => i.reasons.some(r => r.type === 'dependency') ||
           i.file.includes('package.json') ||
           i.file.endsWith('go.mod')
    );

    if (depImpacts.length === 0) {
      return [];
    }

    // Any target component could be affected
    const targetComponents = targetRepo.impacts.map(i => i.component);

    if (targetComponents.length > 0) {
      for (const sourceImpact of depImpacts) {
        impacts.push({
          sourceRepo: sourceRepo.name,
          sourceComponent: sourceImpact.component,
          targetRepo: targetRepo.name,
          targetComponents: [...new Set(targetComponents)],
          relation: 'npm-package',
        });
      }
    }

    return impacts;
  }

  /**
   * Simple glob pattern matching
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');

    return new RegExp(regexPattern).test(filePath);
  }

  /**
   * Remove duplicate cross-repo impacts
   */
  private deduplicateCrossImpacts(impacts: CrossRepoImpact[]): CrossRepoImpact[] {
    const map = new Map<string, CrossRepoImpact>();

    for (const impact of impacts) {
      const key = `${impact.sourceRepo}::${impact.sourceComponent}::${impact.targetRepo}::${impact.relation}`;
      const existing = map.get(key);

      if (existing) {
        // Merge target components
        const allTargets = new Set([...existing.targetComponents, ...impact.targetComponents]);
        existing.targetComponents = [...allTargets];
      } else {
        map.set(key, { ...impact, targetComponents: [...impact.targetComponents] });
      }
    }

    return Array.from(map.values());
  }
}
