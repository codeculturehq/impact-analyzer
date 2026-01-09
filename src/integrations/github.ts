import type { AnalysisResult, GitHubAnnotation } from '../types/index.js';

export interface GitHubCheckOptions {
  owner: string;
  repo: string;
  sha: string;
  token: string;
}

/**
 * Create GitHub Check with annotations for impact analysis
 */
export async function createGitHubCheck(
  result: AnalysisResult,
  options: GitHubCheckOptions
): Promise<void> {
  const annotations = generateAnnotations(result);

  // Determine conclusion based on results
  const conclusion = result.summary.hasBreakingChanges ? 'failure' : 'success';

  // Create check run
  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/check-runs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Impact Analysis',
        head_sha: options.sha,
        status: 'completed',
        conclusion,
        output: {
          title: 'Impact Analysis Results',
          summary: generateSummary(result),
          annotations: annotations.slice(0, 50), // GitHub limits to 50 annotations per request
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create GitHub check: ${error}`);
  }

  // If there are more than 50 annotations, update the check run with additional batches
  if (annotations.length > 50) {
    const checkRun = await response.json() as { id: number };
    await updateCheckWithMoreAnnotations(
      options,
      checkRun.id,
      annotations.slice(50)
    );
  }
}

/**
 * Update check run with additional annotations (batched)
 */
async function updateCheckWithMoreAnnotations(
  options: GitHubCheckOptions,
  checkRunId: number,
  annotations: GitHubAnnotation[]
): Promise<void> {
  const batches = [];
  for (let i = 0; i < annotations.length; i += 50) {
    batches.push(annotations.slice(i, i + 50));
  }

  for (const batch of batches) {
    const response = await fetch(
      `https://api.github.com/repos/${options.owner}/${options.repo}/check-runs/${checkRunId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          output: {
            title: 'Impact Analysis Results',
            summary: 'Additional annotations',
            annotations: batch,
          },
        }),
      }
    );

    if (!response.ok) {
      console.warn('Failed to add additional annotations batch');
    }
  }
}

/**
 * Generate annotations from analysis result
 */
export function generateAnnotations(result: AnalysisResult): GitHubAnnotation[] {
  const annotations: GitHubAnnotation[] = [];

  for (const repo of result.repos) {
    for (const impact of repo.impacts) {
      const level = getAnnotationLevel(impact.reasons);
      const message = impact.reasons
        .map((r) => `[${r.type}] ${r.description}`)
        .join('\n');

      annotations.push({
        path: impact.file,
        start_line: impact.line || 1,
        end_line: impact.line || 1,
        annotation_level: level,
        title: `Impact: ${impact.component}`,
        message,
      });
    }
  }

  // Add cross-repo impact annotations
  for (const crossImpact of result.crossRepoImpacts) {
    annotations.push({
      path: 'impact-analysis',
      start_line: 1,
      end_line: 1,
      annotation_level: 'warning',
      title: `Cross-Repo Impact: ${crossImpact.sourceRepo} → ${crossImpact.targetRepo}`,
      message: `Change to ${crossImpact.sourceComponent} may affect: ${crossImpact.targetComponents.join(', ')} (via ${crossImpact.relation})`,
    });
  }

  return annotations;
}

/**
 * Determine annotation level based on impact reasons
 */
function getAnnotationLevel(
  reasons: Array<{ type: string; description: string }>
): 'notice' | 'warning' | 'failure' {
  for (const reason of reasons) {
    if (reason.type === 'schema' || reason.description.toLowerCase().includes('breaking')) {
      return 'failure';
    }
    if (reason.type === 'dependency' || reason.type === 'config') {
      return 'warning';
    }
  }
  return 'notice';
}

/**
 * Generate summary for GitHub check
 */
function generateSummary(result: AnalysisResult): string {
  let summary = `## Impact Analysis Summary

| Metric | Value |
|--------|-------|
| Total Changed Files | ${result.summary.totalChangedFiles} |
| Total Impacted Components | ${result.summary.totalImpactedComponents} |
| Cross-Repo Impacts | ${result.crossRepoImpacts.length} |
| Breaking Changes | ${result.summary.hasBreakingChanges ? '⚠️ Yes' : '✅ No'} |

### Per-Repository Breakdown

`;

  for (const repo of result.summary.repos) {
    summary += `- **${repo.name}**: ${repo.changedFiles} files, ${repo.impactCount} impacts\n`;
  }

  if (result.crossRepoImpacts.length > 0) {
    summary += '\n### Cross-Repository Impacts\n\n';
    for (const impact of result.crossRepoImpacts) {
      summary += `- **${impact.sourceRepo}** → **${impact.targetRepo}** (${impact.relation})\n`;
    }
  }

  return summary;
}

/**
 * Post comment to PR
 */
export async function postPRComment(
  result: AnalysisResult,
  options: GitHubCheckOptions & { prNumber: number }
): Promise<void> {
  const comment = generateGitHubComment(result);

  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/issues/${options.prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: comment }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to post PR comment: ${error}`);
  }
}

/**
 * Generate GitHub PR comment markdown
 */
function generateGitHubComment(result: AnalysisResult): string {
  let comment = `## 🔍 Impact Analysis

| Metric | Value |
|--------|-------|
| Changed Files | ${result.summary.totalChangedFiles} |
| Impacted Components | ${result.summary.totalImpactedComponents} |
| Cross-Repo Impacts | ${result.crossRepoImpacts.length} |
| Breaking Changes | ${result.summary.hasBreakingChanges ? '⚠️ Yes' : '✅ No'} |

`;

  if (result.summary.totalImpactedComponents === 0 && result.crossRepoImpacts.length === 0) {
    comment += '✅ **No impacts detected.**\n';
    return comment;
  }

  if (result.summary.totalImpactedComponents > 0) {
    comment += `<details>\n<summary>📋 Impacted Components (${result.summary.totalImpactedComponents})</summary>\n\n`;

    for (const repo of result.repos) {
      if (repo.impacts.length === 0) continue;

      comment += `### ${repo.name}\n\n`;

      for (const impact of repo.impacts) {
        comment += `- **${impact.component}** (\`${impact.file}\`)\n`;
        for (const reason of impact.reasons) {
          comment += `  - ${reason.description}\n`;
        }
      }

      comment += '\n';
    }

    comment += '</details>\n\n';
  }

  if (result.crossRepoImpacts.length > 0) {
    comment += `<details>\n<summary>🔗 Cross-Repository Impacts (${result.crossRepoImpacts.length})</summary>\n\n`;

    for (const crossImpact of result.crossRepoImpacts) {
      comment += `#### ${crossImpact.sourceRepo} → ${crossImpact.targetRepo}\n\n`;
      comment += `- **Via:** ${crossImpact.relation}\n`;
      comment += `- **Source:** ${crossImpact.sourceComponent}\n`;
      comment += `- **May affect:** ${crossImpact.targetComponents.join(', ')}\n\n`;
    }

    comment += '</details>\n\n';
  }

  comment += `---\n*Generated by [@codeculture/impact-analyzer](https://github.com/codeculturehq/impact-analyzer)*\n`;

  return comment;
}
