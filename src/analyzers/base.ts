import { execa } from 'execa';
import type { RepoConfig, ImpactItem } from '../types/index.js';

/**
 * Abstract base class for all analyzers
 */
export abstract class BaseAnalyzer {
  protected readonly repoPath: string;

  constructor(
    protected readonly config: RepoConfig,
    protected readonly baseRef: string,
    protected readonly headRef: string
  ) {
    this.repoPath = config.path;
  }

  /**
   * Run the analysis and return impact items
   */
  abstract analyze(): Promise<ImpactItem[]>;

  /**
   * Get the analyzer name for logging
   */
  abstract get name(): string;

  /**
   * Get list of files changed between base and head refs
   */
  protected async getChangedFiles(): Promise<string[]> {
    try {
      const { stdout } = await execa(
        'git',
        ['diff', '--name-only', `${this.baseRef}...${this.headRef}`],
        { cwd: this.repoPath }
      );

      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      // Fallback: try without the three-dot syntax
      try {
        const { stdout } = await execa('git', ['diff', '--name-only', this.baseRef, this.headRef], {
          cwd: this.repoPath,
        });

        return stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      } catch {
        console.error(`Failed to get changed files for ${this.config.name}:`, error);
        return [];
      }
    }
  }

  /**
   * Get the diff for a specific file
   */
  protected async getFileDiff(filePath: string): Promise<string> {
    try {
      const { stdout } = await execa(
        'git',
        ['diff', '-U3', `${this.baseRef}...${this.headRef}`, '--', filePath],
        { cwd: this.repoPath }
      );
      return stdout;
    } catch {
      return '';
    }
  }

  /**
   * Check if a file exists in the repo
   */
  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await execa('test', ['-f', `${this.repoPath}/${filePath}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a file from the repo
   */
  protected async readFile(filePath: string): Promise<string | null> {
    try {
      const { stdout } = await execa('cat', [`${this.repoPath}/${filePath}`]);
      return stdout;
    } catch {
      return null;
    }
  }

  /**
   * Filter changed files by extension(s)
   */
  protected filterByExtension(files: string[], ...extensions: string[]): string[] {
    return files.filter((file) => extensions.some((ext) => file.endsWith(ext)));
  }

  /**
   * Filter changed files by path prefix
   */
  protected filterByPath(files: string[], prefix: string): string[] {
    return files.filter((file) => file.startsWith(prefix));
  }

  /**
   * Remove duplicates from impact items based on component + file
   */
  protected deduplicateImpacts(impacts: ImpactItem[]): ImpactItem[] {
    const map = new Map<string, ImpactItem>();

    for (const impact of impacts) {
      const key = `${impact.component}::${impact.file}`;
      const existing = map.get(key);

      if (existing) {
        // Merge reasons
        const existingReasons = new Set(existing.reasons.map((r) => `${r.type}::${r.source}`));
        for (const reason of impact.reasons) {
          if (!existingReasons.has(`${reason.type}::${reason.source}`)) {
            existing.reasons.push(reason);
          }
        }
      } else {
        map.set(key, { ...impact });
      }
    }

    return Array.from(map.values());
  }

  /**
   * Create an impact item
   */
  protected createImpact(
    component: string,
    file: string,
    reasonType: ImpactItem['reasons'][0]['type'],
    source: string,
    description: string
  ): ImpactItem {
    return {
      component,
      repo: this.config.name,
      file,
      reasons: [
        {
          type: reasonType,
          source,
          description,
        },
      ],
    };
  }
}
