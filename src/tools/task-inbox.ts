import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveComment, ProductivePerson, ProductiveProject } from '../api/types.js';

const taskInboxSchema = z.object({
  limit: z.number().min(1).max(50).default(10).optional(),
});

/**
 * Format a date as relative time (e.g., "2 days ago", "today")
 */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return date.toLocaleDateString();
}

/**
 * Strip HTML tags from comment body
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

export async function taskInboxTool(
  client: ProductiveAPIClient,
  config: Config,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // Check if user ID is configured
    if (!config.PRODUCTIVE_USER_ID) {
      return {
        content: [{
          type: 'text',
          text: 'User ID not configured. Please set PRODUCTIVE_USER_ID in your environment variables to use this feature.',
        }],
      };
    }

    const params = taskInboxSchema.parse(args || {});
    const limit = params.limit || 10;

    // Step 1: Fetch user's open tasks sorted by last activity, include project
    const tasksResponse = await client.listTasks({
      assignee_id: config.PRODUCTIVE_USER_ID,
      status: 'open',
      limit: limit,
      sort: '-last_activity_at',
      include: ['project'],
    });

    if (!tasksResponse || !tasksResponse.data || tasksResponse.data.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No tasks in your inbox.',
        }],
      };
    }

    // Build project lookup map from included data
    const projectMap = new Map<string, string>();
    const includedData = (tasksResponse as any).included as Array<ProductiveProject | ProductivePerson> | undefined;
    if (includedData) {
      includedData
        .filter((item): item is ProductiveProject => item.type === 'projects')
        .forEach(project => {
          projectMap.set(project.id, project.attributes.name);
        });
    }

    // Step 2: Fetch latest comment for each task in parallel
    const taskIds = tasksResponse.data.map(task => task.id);

    // Fetch comments per-task using Promise.all for parallel execution
    const commentResponses = await Promise.all(
      taskIds.map(taskId =>
        client.listComments({ task_ids: [taskId], limit: 1 })
      )
    );

    // Build person lookup map from all comment responses
    const personMap = new Map<string, string>();
    commentResponses.forEach(response => {
      const included = (response as any).included as Array<ProductivePerson> | undefined;
      if (included) {
        included
          .filter((item): item is ProductivePerson => item.type === 'people')
          .forEach(person => {
            const fullName = `${person.attributes.first_name} ${person.attributes.last_name}`.trim();
            personMap.set(person.id, fullName || person.attributes.email);
          });
      }
    });

    // Build task -> latest comment lookup map
    const taskCommentMap = new Map<string, ProductiveComment>();
    commentResponses.forEach((response, index) => {
      const taskId = taskIds[index];
      if (response.data && response.data.length > 0) {
        taskCommentMap.set(taskId, response.data[0]);
      }
    });

    // Step 3: Format output
    const tasksOutput = tasksResponse.data.map((task, index) => {
      const projectId = task.relationships?.project?.data?.id;
      const projectName = projectId ? projectMap.get(projectId) || 'Unknown Project' : 'No Project';
      const lastActivity = task.attributes.last_activity_at || task.attributes.updated_at;
      const taskUrl = `https://app.productive.io/${config.PRODUCTIVE_ORG_ID}/tasks/${task.id}`;

      // Get latest comment for this task
      const latestComment = taskCommentMap.get(task.id);
      const taskDescription = task.attributes.description ? stripHtml(task.attributes.description) : '';
      let contentLine: string;

      if (latestComment) {
        const creatorId = latestComment.relationships?.creator?.data?.id;
        const authorName = creatorId ? personMap.get(creatorId) || 'Unknown' : 'Unknown';
        const commentBody = stripHtml(latestComment.attributes.body);
        contentLine = `   ${authorName}: ${commentBody}`;
      } else if (taskDescription) {
        contentLine = `   Description: ${taskDescription}`;
      } else {
        contentLine = '   No content';
      }

      return `${index + 1}. ${taskUrl} | ${projectName} | ${formatRelativeTime(lastActivity)}\n${contentLine}`;
    }).join('\n\n');

    const totalCount = tasksResponse.meta?.total_count || tasksResponse.data.length;
    const header = `Task Inbox (${tasksResponse.data.length}${totalCount > tasksResponse.data.length ? ` of ${totalCount}` : ''} tasks)\n\n`;

    // Generate suggested action items
    const actionItems: string[] = [];

    tasksResponse.data.forEach((task, index) => {
      const taskNum = index + 1;
      const taskTitle = task.attributes.title;
      const latestComment = taskCommentMap.get(task.id);
      const isCritical = taskTitle.toLowerCase().includes('critical') || taskTitle.includes('⚠️');
      const isBug = taskTitle.toLowerCase().includes('bug');

      if (latestComment) {
        const commentBody = stripHtml(latestComment.attributes.body).toLowerCase();
        const creatorId = latestComment.relationships?.creator?.data?.id;
        const authorName = creatorId ? personMap.get(creatorId) || 'Someone' : 'Someone';

        // Check for questions or requests directed at user
        if (commentBody.includes('?') || commentBody.includes('@')) {
          if (commentBody.includes('close') || commentBody.includes('chiudi')) {
            actionItems.push(`#${taskNum} - ${authorName} is asking about closing this task. Review and respond.`);
          } else if (commentBody.includes('review') || commentBody.includes('controlla')) {
            actionItems.push(`#${taskNum} - Review requested by ${authorName}.`);
          } else if (commentBody.includes('help') || commentBody.includes('aiut')) {
            actionItems.push(`#${taskNum} - ${authorName} is asking for help.`);
          } else if (commentBody.includes('publish') || commentBody.includes('pubblica')) {
            actionItems.push(`#${taskNum} - ${authorName} needs you to publish something.`);
          } else if (commentBody.includes('?')) {
            actionItems.push(`#${taskNum} - ${authorName} asked a question. Respond.`);
          } else {
            actionItems.push(`#${taskNum} - You were mentioned. Check and respond.`);
          }
        }
      } else if (isCritical) {
        actionItems.push(`#${taskNum} - CRITICAL bug needs immediate attention.`);
      } else if (isBug) {
        actionItems.push(`#${taskNum} - Bug to investigate.`);
      }
    });

    let actionItemsSection = '';
    if (actionItems.length > 0) {
      actionItemsSection = '\n\nSuggested Actions:\n' + actionItems.join('\n');
    }

    return {
      content: [{
        type: 'text',
        text: header + tasksOutput + actionItemsSection,
      }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const taskInboxDefinition = {
  name: 'task_inbox',
  description: 'Show your task inbox - assigned tasks sorted by recent activity with the latest comment for each task. Requires PRODUCTIVE_USER_ID to be configured.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of tasks to return (1-50, default: 10)',
        minimum: 1,
        maximum: 50,
        default: 10,
      },
    },
  },
};
