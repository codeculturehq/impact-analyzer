import type { AnalysisResult } from '../types/index.js';

export interface SlackOptions {
  webhook: string;
  channel?: string;
}

export interface SlackMessage {
  channel?: string;
  text: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text: string;
    emoji?: boolean;
  }>;
  fields?: Array<{
    type: string;
    text: string;
  }>;
}

export interface SlackAttachment {
  color: string;
  blocks?: SlackBlock[];
}

/**
 * Send impact analysis notification to Slack
 */
export async function sendSlackNotification(
  result: AnalysisResult,
  options: SlackOptions
): Promise<void> {
  const message = generateSlackMessage(result, options.channel);

  const response = await fetch(options.webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send Slack notification: ${error}`);
  }
}

/**
 * Generate Slack Block Kit message from analysis result
 */
export function generateSlackMessage(
  result: AnalysisResult,
  channel?: string
): SlackMessage {
  const hasImpacts = result.summary.totalImpactedComponents > 0 || result.crossRepoImpacts.length > 0;
  const statusEmoji = result.summary.hasBreakingChanges ? ':warning:' : hasImpacts ? ':mag:' : ':white_check_mark:';
  const statusText = result.summary.hasBreakingChanges
    ? 'Breaking changes detected!'
    : hasImpacts
      ? 'Impacts detected'
      : 'No impacts detected';

  const blocks: SlackBlock[] = [
    // Header
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} Impact Analysis: ${statusText}`,
        emoji: true,
      },
    },
    // Summary stats
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Changed Files:*\n${result.summary.totalChangedFiles}`,
        },
        {
          type: 'mrkdwn',
          text: `*Impacted Components:*\n${result.summary.totalImpactedComponents}`,
        },
        {
          type: 'mrkdwn',
          text: `*Cross-Repo Impacts:*\n${result.crossRepoImpacts.length}`,
        },
        {
          type: 'mrkdwn',
          text: `*Breaking Changes:*\n${result.summary.hasBreakingChanges ? ':red_circle: Yes' : ':large_green_circle: No'}`,
        },
      ],
    },
  ];

  // Per-repo breakdown (if any impacts)
  if (result.summary.repos.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Per-Repository Breakdown:*',
      },
    });

    const repoLines = result.summary.repos
      .map((repo) => `• *${repo.name}*: ${repo.changedFiles} files, ${repo.impactCount} impacts`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: repoLines,
      },
    });
  }

  // Cross-repo impacts
  if (result.crossRepoImpacts.length > 0) {
    blocks.push({
      type: 'divider' as string,
    });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*:link: Cross-Repository Impacts:*',
      },
    });

    for (const impact of result.crossRepoImpacts.slice(0, 5)) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${impact.sourceRepo}* → *${impact.targetRepo}* _(${impact.relation})_\n• Source: \`${impact.sourceComponent}\`\n• Affects: ${impact.targetComponents.slice(0, 3).map(c => `\`${c}\``).join(', ')}${impact.targetComponents.length > 3 ? ` +${impact.targetComponents.length - 3} more` : ''}`,
        },
      });
    }

    if (result.crossRepoImpacts.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_+${result.crossRepoImpacts.length - 5} more cross-repo impacts..._`,
          },
        ],
      });
    }
  }

  // Divider and context
  blocks.push({
    type: 'divider' as string,
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Analyzed at ${result.meta.timestamp} | ${result.meta.baseRef}...${result.meta.headRef}`,
      },
    ],
  });

  // Build message
  const message: SlackMessage = {
    text: `Impact Analysis: ${statusText}`,
    blocks,
  };

  if (channel) {
    message.channel = channel;
  }

  // Add color attachment for visual indication
  message.attachments = [
    {
      color: result.summary.hasBreakingChanges ? '#FF0000' : hasImpacts ? '#FFA500' : '#36A64F',
      blocks: [],
    },
  ];

  return message;
}

/**
 * Build simple notification text for Slack
 */
export function generateSimpleSlackText(result: AnalysisResult): string {
  const statusEmoji = result.summary.hasBreakingChanges ? '⚠️' : '🔍';
  const lines = [
    `${statusEmoji} *Impact Analysis Summary*`,
    '',
    `• Changed Files: ${result.summary.totalChangedFiles}`,
    `• Impacted Components: ${result.summary.totalImpactedComponents}`,
    `• Cross-Repo Impacts: ${result.crossRepoImpacts.length}`,
    `• Breaking Changes: ${result.summary.hasBreakingChanges ? 'Yes' : 'No'}`,
  ];

  if (result.crossRepoImpacts.length > 0) {
    lines.push('', '*Cross-Repo Impacts:*');
    for (const impact of result.crossRepoImpacts.slice(0, 3)) {
      lines.push(`• ${impact.sourceRepo} → ${impact.targetRepo} (${impact.relation})`);
    }
    if (result.crossRepoImpacts.length > 3) {
      lines.push(`_+${result.crossRepoImpacts.length - 3} more..._`);
    }
  }

  return lines.join('\n');
}
