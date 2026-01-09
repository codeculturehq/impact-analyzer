import { Project, SyntaxKind, ClassDeclaration } from 'ts-morph';
import path from 'node:path';
import { BaseAnalyzer } from './base.js';
import type { ImpactItem, RepoConfig } from '../types/index.js';

interface AngularComponent {
  name: string;
  file: string;
  selector?: string;
  templateUrl?: string;
  styleUrls?: string[];
  inlineTemplate?: boolean;
  inlineStyles?: boolean;
}

interface AngularService {
  name: string;
  file: string;
  providedIn?: string;
}

interface AngularModule {
  name: string;
  file: string;
  declarations: string[];
  imports: string[];
  exports: string[];
  providers: string[];
}

/**
 * Analyzer for Angular projects using ts-morph for AST analysis
 */
export class AngularAnalyzer extends BaseAnalyzer {
  private project: Project | null = null;
  private componentMap: Map<string, AngularComponent> = new Map();
  private serviceMap: Map<string, AngularService> = new Map();
  private moduleMap: Map<string, AngularModule> = new Map();
  private templateToComponent: Map<string, string> = new Map();
  private styleToComponent: Map<string, string> = new Map();

  constructor(
    config: RepoConfig,
    baseRef: string,
    headRef: string
  ) {
    super(config, baseRef, headRef);
  }

  get name(): string {
    return 'angular';
  }

  async analyze(): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    // Get changed files
    const changedFiles = await this.getChangedFiles();
    if (changedFiles.length === 0) {
      return [];
    }

    // Initialize ts-morph project
    await this.initializeProject();
    if (!this.project) {
      console.error(`Failed to initialize ts-morph for ${this.config.name}`);
      return [];
    }

    // Build component/service/module maps
    await this.buildMaps();

    // Analyze each changed file
    for (const file of changedFiles) {
      const fileImpacts = await this.analyzeFile(file, changedFiles);
      impacts.push(...fileImpacts);
    }

    return this.deduplicateImpacts(impacts);
  }

  /**
   * Initialize ts-morph project
   */
  private async initializeProject(): Promise<void> {
    try {
      const tsconfigPath = path.join(this.repoPath, 'tsconfig.json');

      this.project = new Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: false,
      });
    } catch (error) {
      // Fallback: create project without tsconfig
      console.warn(`Could not load tsconfig.json for ${this.config.name}, using fallback`);
      this.project = new Project({
        compilerOptions: {
          target: 99, // ESNext
          module: 99, // ESNext
          strict: true,
          esModuleInterop: true,
        },
      });

      // Add source files manually
      const srcPath = path.join(this.repoPath, 'src');
      this.project.addSourceFilesAtPaths([
        `${srcPath}/**/*.ts`,
        `!${srcPath}/**/*.spec.ts`,
      ]);
    }
  }

  /**
   * Build maps of components, services, and modules
   */
  private async buildMaps(): Promise<void> {
    if (!this.project) return;

    const sourceFiles = this.project.getSourceFiles();

    for (const sourceFile of sourceFiles) {
      const filePath = this.getRelativePath(sourceFile.getFilePath());

      // Skip test files and node_modules
      if (filePath.includes('.spec.ts') || filePath.includes('node_modules')) {
        continue;
      }

      const classes = sourceFile.getClasses();

      for (const classDecl of classes) {
        await this.analyzeClassDecorators(classDecl, filePath);
      }
    }
  }

  /**
   * Analyze class decorators to identify Angular artifacts
   */
  private async analyzeClassDecorators(
    classDecl: ClassDeclaration,
    filePath: string
  ): Promise<void> {
    const className = classDecl.getName() || 'Anonymous';
    const decorators = classDecl.getDecorators();

    for (const decorator of decorators) {
      const decoratorName = decorator.getName();

      switch (decoratorName) {
        case 'Component':
          await this.extractComponentMetadata(classDecl, className, filePath);
          break;
        case 'Injectable':
          await this.extractServiceMetadata(classDecl, className, filePath);
          break;
        case 'NgModule':
          await this.extractModuleMetadata(classDecl, className, filePath);
          break;
        case 'Directive':
        case 'Pipe':
          // Track as components for simplicity
          this.componentMap.set(className, {
            name: className,
            file: filePath,
          });
          break;
      }
    }
  }

  /**
   * Extract @Component decorator metadata
   */
  private async extractComponentMetadata(
    classDecl: ClassDeclaration,
    className: string,
    filePath: string
  ): Promise<void> {
    const decorator = classDecl.getDecorators().find(d => d.getName() === 'Component');
    if (!decorator) return;

    const component: AngularComponent = {
      name: className,
      file: filePath,
    };

    // Get decorator arguments
    const args = decorator.getArguments()[0];
    if (args && args.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const props = args.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties();

      for (const prop of props) {
        if (prop.getKind() === SyntaxKind.PropertyAssignment) {
          const propAssign = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
          const propName = propAssign.getName();
          const initializer = propAssign.getInitializer();

          if (initializer) {
            switch (propName) {
              case 'selector':
                component.selector = this.extractStringLiteral(initializer);
                break;
              case 'templateUrl':
                const templateUrl = this.extractStringLiteral(initializer);
                if (templateUrl) {
                  component.templateUrl = this.resolveRelativePath(filePath, templateUrl);
                  this.templateToComponent.set(component.templateUrl, className);
                }
                break;
              case 'template':
                component.inlineTemplate = true;
                break;
              case 'styleUrls':
                component.styleUrls = this.extractStringArray(initializer);
                component.styleUrls?.forEach(styleUrl => {
                  const resolved = this.resolveRelativePath(filePath, styleUrl);
                  this.styleToComponent.set(resolved, className);
                });
                break;
              case 'styles':
                component.inlineStyles = true;
                break;
            }
          }
        }
      }
    }

    this.componentMap.set(className, component);
  }

  /**
   * Extract @Injectable decorator metadata
   */
  private async extractServiceMetadata(
    classDecl: ClassDeclaration,
    className: string,
    filePath: string
  ): Promise<void> {
    const service: AngularService = {
      name: className,
      file: filePath,
    };

    const decorator = classDecl.getDecorators().find(d => d.getName() === 'Injectable');
    if (decorator) {
      const args = decorator.getArguments()[0];
      if (args && args.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const props = args.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties();
        for (const prop of props) {
          if (prop.getKind() === SyntaxKind.PropertyAssignment) {
            const propAssign = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
            if (propAssign.getName() === 'providedIn') {
              service.providedIn = this.extractStringLiteral(propAssign.getInitializer()!);
            }
          }
        }
      }
    }

    this.serviceMap.set(className, service);
  }

  /**
   * Extract @NgModule decorator metadata
   */
  private async extractModuleMetadata(
    classDecl: ClassDeclaration,
    className: string,
    filePath: string
  ): Promise<void> {
    const module: AngularModule = {
      name: className,
      file: filePath,
      declarations: [],
      imports: [],
      exports: [],
      providers: [],
    };

    const decorator = classDecl.getDecorators().find(d => d.getName() === 'NgModule');
    if (decorator) {
      const args = decorator.getArguments()[0];
      if (args && args.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const props = args.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties();

        for (const prop of props) {
          if (prop.getKind() === SyntaxKind.PropertyAssignment) {
            const propAssign = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
            const propName = propAssign.getName();
            const initializer = propAssign.getInitializer();

            if (initializer && initializer.getKind() === SyntaxKind.ArrayLiteralExpression) {
              const items = this.extractIdentifierArray(initializer);
              switch (propName) {
                case 'declarations':
                  module.declarations = items;
                  break;
                case 'imports':
                  module.imports = items;
                  break;
                case 'exports':
                  module.exports = items;
                  break;
                case 'providers':
                  module.providers = items;
                  break;
              }
            }
          }
        }
      }
    }

    this.moduleMap.set(className, module);
  }

  /**
   * Analyze a single changed file and return impacts
   */
  private async analyzeFile(file: string, _allChangedFiles: string[]): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    // TypeScript/Component files
    if (file.endsWith('.ts') && !file.endsWith('.spec.ts')) {
      impacts.push(...await this.analyzeTypeScriptFile(file));
    }

    // Template files (HTML)
    if (file.endsWith('.html')) {
      impacts.push(...await this.analyzeTemplateFile(file));
    }

    // Style files (SCSS/CSS)
    if (file.endsWith('.scss') || file.endsWith('.css')) {
      impacts.push(...await this.analyzeStyleFile(file));
    }

    // Module files (special handling)
    if (file.includes('.module.ts')) {
      impacts.push(...await this.analyzeModuleFile(file));
    }

    return impacts;
  }

  /**
   * Analyze TypeScript file changes
   */
  private async analyzeTypeScriptFile(file: string): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    // Check if this is a component file
    for (const [name, component] of this.componentMap) {
      if (component.file === file) {
        impacts.push(this.createImpact(
          name,
          file,
          'direct',
          file,
          `Component ${name} was directly modified`
        ));

        // Find components that depend on this component via module
        const dependentComponents = this.findDependentComponents(name);
        for (const dep of dependentComponents) {
          impacts.push(this.createImpact(
            dep.name,
            dep.file,
            'dependency',
            file,
            `Component ${dep.name} depends on modified component ${name}`
          ));
        }
      }
    }

    // Check if this is a service file
    for (const [name, service] of this.serviceMap) {
      if (service.file === file) {
        impacts.push(this.createImpact(
          name,
          file,
          'direct',
          file,
          `Service ${name} was directly modified`
        ));

        // Find components that inject this service
        const consumers = await this.findServiceConsumers(name);
        for (const consumer of consumers) {
          impacts.push(this.createImpact(
            consumer.name,
            consumer.file,
            'dependency',
            file,
            `Component ${consumer.name} injects modified service ${name}`
          ));
        }
      }
    }

    return impacts;
  }

  /**
   * Analyze template file changes
   */
  private async analyzeTemplateFile(file: string): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    // Find component that owns this template
    const componentName = this.templateToComponent.get(file);
    if (componentName) {
      const component = this.componentMap.get(componentName);
      if (component) {
        impacts.push(this.createImpact(
          componentName,
          component.file,
          'template',
          file,
          `Template for ${componentName} was modified`
        ));

        // Also mark dependent components
        const dependentComponents = this.findDependentComponents(componentName);
        for (const dep of dependentComponents) {
          impacts.push(this.createImpact(
            dep.name,
            dep.file,
            'template',
            file,
            `Template change in ${componentName} may affect ${dep.name}`
          ));
        }
      }
    }

    return impacts;
  }

  /**
   * Analyze style file changes
   */
  private async analyzeStyleFile(file: string): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    // Find component that owns this style
    const componentName = this.styleToComponent.get(file);
    if (componentName) {
      const component = this.componentMap.get(componentName);
      if (component) {
        impacts.push(this.createImpact(
          componentName,
          component.file,
          'style',
          file,
          `Styles for ${componentName} were modified`
        ));
      }
    }

    // Check for global styles
    if (file.includes('styles') || file.includes('theme') || file.includes('global')) {
      impacts.push(this.createImpact(
        'Global Styles',
        file,
        'style',
        file,
        'Global style file was modified - may affect multiple components'
      ));
    }

    return impacts;
  }

  /**
   * Analyze module file changes
   */
  private async analyzeModuleFile(file: string): Promise<ImpactItem[]> {
    const impacts: ImpactItem[] = [];

    for (const [name, module] of this.moduleMap) {
      if (module.file === file) {
        impacts.push(this.createImpact(
          name,
          file,
          'module',
          file,
          `Module ${name} was modified`
        ));

        // All declarations in this module might be affected
        for (const declaration of module.declarations) {
          const component = this.componentMap.get(declaration);
          if (component) {
            impacts.push(this.createImpact(
              declaration,
              component.file,
              'module',
              file,
              `Component ${declaration} is declared in modified module ${name}`
            ));
          }
        }
      }
    }

    return impacts;
  }

  /**
   * Find components that depend on a given component
   */
  private findDependentComponents(componentName: string): AngularComponent[] {
    const dependents: AngularComponent[] = [];
    const component = this.componentMap.get(componentName);

    if (!component?.selector) return dependents;

    // Find modules that declare this component
    for (const [, module] of this.moduleMap) {
      if (module.declarations.includes(componentName) || module.exports.includes(componentName)) {
        // All other declarations in this module could use this component
        for (const declaration of module.declarations) {
          if (declaration !== componentName) {
            const dep = this.componentMap.get(declaration);
            if (dep) {
              dependents.push(dep);
            }
          }
        }
      }
    }

    return dependents;
  }

  /**
   * Find components that inject a given service
   */
  private async findServiceConsumers(serviceName: string): Promise<AngularComponent[]> {
    const consumers: AngularComponent[] = [];

    if (!this.project) return consumers;

    // Search for constructor injections
    for (const [_name, component] of this.componentMap) {
      const sourceFile = this.project.getSourceFile(
        path.join(this.repoPath, component.file)
      );

      if (sourceFile) {
        const text = sourceFile.getText();
        // Simple check: look for the service name in the constructor
        if (text.includes(serviceName)) {
          consumers.push(component);
        }
      }
    }

    return consumers;
  }

  /**
   * Helper: Extract string literal value
   */
  private extractStringLiteral(node: { getText(): string }): string | undefined {
    const text = node.getText();
    // Remove quotes
    if (text.startsWith("'") || text.startsWith('"') || text.startsWith('`')) {
      return text.slice(1, -1);
    }
    return undefined;
  }

  /**
   * Helper: Extract array of strings
   */
  private extractStringArray(node: { getText(): string }): string[] {
    const text = node.getText();
    const match = text.match(/\[(.*)\]/s);
    if (match && match[1]) {
      return match[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.replace(/^['"`]|['"`]$/g, ''));
    }
    return [];
  }

  /**
   * Helper: Extract array of identifiers
   */
  private extractIdentifierArray(node: { getText(): string }): string[] {
    const text = node.getText();
    const match = text.match(/\[(.*)\]/s);
    if (match && match[1]) {
      return match[1]
        .split(',')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith("'") && !s.startsWith('"'));
    }
    return [];
  }

  /**
   * Helper: Get relative path from repo root
   */
  private getRelativePath(absolutePath: string): string {
    return path.relative(this.repoPath, absolutePath);
  }

  /**
   * Helper: Resolve relative path from a file
   */
  private resolveRelativePath(fromFile: string, relativePath: string): string {
    const dir = path.dirname(fromFile);
    return path.normalize(path.join(dir, relativePath));
  }
}
