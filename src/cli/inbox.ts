#!/usr/bin/env node
/**
 * CLI script to display task inbox from Productive.io
 *
 * Usage:
 *   npm run inbox
 *   ./build/cli/inbox.js [options]
 *
 * Options:
 *   --full     Show full content (no truncation)
 *   --actions  Show suggested actions section
 *   --limit N  Number of tasks to show (default: 10)
 */

import 'dotenv/config';
import { ProductiveAPIClient } from '../api/client.js';
import { getConfig } from '../config/index.js';
import { ProductiveComment, ProductivePerson, ProductiveProject } from '../api/types.js';

// Parse CLI arguments
const args = process.argv.slice(2);
const showFull = args.includes('--full');
const showActions = args.includes('--actions');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 && args[limitIndex + 1]
  ? parseInt(args[limitIndex + 1], 10)
  : 10;

const MAX_CONTENT_LENGTH = 200;

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
 * Strip HTML tags from text
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

/**
 * Clean mention JSON to readable @Name format
 * Replaces @[{"type":"person","id":"123","label":"Name"...}] with @Name
 */
function cleanMentions(text: string): string {
  return text.replace(/@\[\{[^}]*"label"\s*:\s*"([^"]+)"[^}]*\}\]/g, '@$1');
}

/**
 * Truncate text to maxLength, adding ellipsis if needed
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

async function main() {
  try {
    const config = getConfig();

    if (!config.PRODUCTIVE_USER_ID) {
      console.error('Error: PRODUCTIVE_USER_ID not configured in environment variables.');
      process.exit(1);
    }

    const client = new ProductiveAPIClient(config);

    // Fetch tasks
    const tasksResponse = await client.listTasks({
      assignee_id: config.PRODUCTIVE_USER_ID,
      status: 'open',
      limit: limit,
      sort: '-last_activity_at',
      include: ['project'],
    });

    if (!tasksResponse?.data?.length) {
      console.log('No tasks in your inbox.');
      return;
    }

    // Build project lookup map
    const projectMap = new Map<string, string>();
    const includedData = (tasksResponse as any).included as Array<ProductiveProject | ProductivePerson> | undefined;
    if (includedData) {
      includedData
        .filter((item): item is ProductiveProject => item.type === 'projects')
        .forEach(project => {
          projectMap.set(project.id, project.attributes.name);
        });
    }

    // Fetch comments for each task in parallel
    const taskIds = tasksResponse.data.map(task => task.id);
    const commentResponses = await Promise.all(
      taskIds.map(taskId =>
        client.listComments({ task_ids: [taskId], limit: 1 })
      )
    );

    // Build person lookup map
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

    // Build task -> comment map
    const taskCommentMap = new Map<string, ProductiveComment>();
    commentResponses.forEach((response, index) => {
      const taskId = taskIds[index];
      if (response.data?.length) {
        taskCommentMap.set(taskId, response.data[0]);
      }
    });

    // Format output
    const totalCount = tasksResponse.meta?.total_count || tasksResponse.data.length;
    console.log(`Task Inbox (${tasksResponse.data.length}${totalCount > tasksResponse.data.length ? ` of ${totalCount}` : ''} tasks)\n`);

    const actionItems: string[] = [];

    tasksResponse.data.forEach((task, index) => {
      const projectId = task.relationships?.project?.data?.id;
      const projectName = projectId ? projectMap.get(projectId) || 'Unknown Project' : 'No Project';
      const lastActivity = task.attributes.last_activity_at || task.attributes.updated_at;
      const taskUrl = `https://app.productive.io/${config.PRODUCTIVE_ORG_ID}/tasks/${task.id}`;

      // Get content (comment or description)
      const latestComment = taskCommentMap.get(task.id);
      const taskDescription = task.attributes.description ? stripHtml(task.attributes.description) : '';
      let contentLine: string;

      if (latestComment) {
        const creatorId = latestComment.relationships?.creator?.data?.id;
        const authorName = creatorId ? personMap.get(creatorId) || 'Unknown' : 'Unknown';
        let commentBody = cleanMentions(stripHtml(latestComment.attributes.body));
        if (!showFull) commentBody = truncate(commentBody, MAX_CONTENT_LENGTH);
        contentLine = `   ${authorName}: ${commentBody}`;
      } else if (taskDescription) {
        let description = cleanMentions(taskDescription);
        if (!showFull) description = truncate(description, MAX_CONTENT_LENGTH);
        contentLine = `   Description: ${description}`;
      } else {
        contentLine = '   No content';
      }

      console.log(`${index + 1}. ${taskUrl} | ${projectName} | ${formatRelativeTime(lastActivity)}`);
      console.log(contentLine);
      console.log('');

      // Collect action items if --actions flag
      if (showActions) {
        const taskNum = index + 1;
        const taskTitle = task.attributes.title;
        const isCritical = taskTitle.toLowerCase().includes('critical') || taskTitle.includes('⚠️');
        const isBug = taskTitle.toLowerCase().includes('bug');

        if (latestComment) {
          const commentBody = stripHtml(latestComment.attributes.body).toLowerCase();
          const creatorId = latestComment.relationships?.creator?.data?.id;
          const authorName = creatorId ? personMap.get(creatorId) || 'Someone' : 'Someone';

          if (commentBody.includes('?') || commentBody.includes('@')) {
            if (commentBody.includes('close') || commentBody.includes('chiudi')) {
              actionItems.push(`#${taskNum} - ${authorName} is asking about closing this task.`);
            } else if (commentBody.includes('review') || commentBody.includes('controlla')) {
              actionItems.push(`#${taskNum} - Review requested by ${authorName}.`);
            } else if (commentBody.includes('help') || commentBody.includes('aiut')) {
              actionItems.push(`#${taskNum} - ${authorName} is asking for help.`);
            } else if (commentBody.includes('publish') || commentBody.includes('pubblica')) {
              actionItems.push(`#${taskNum} - ${authorName} needs you to publish something.`);
            } else if (commentBody.includes('?')) {
              actionItems.push(`#${taskNum} - ${authorName} asked a question.`);
            } else {
              actionItems.push(`#${taskNum} - You were mentioned.`);
            }
          }
        } else if (isCritical) {
          actionItems.push(`#${taskNum} - CRITICAL bug needs immediate attention.`);
        } else if (isBug) {
          actionItems.push(`#${taskNum} - Bug to investigate.`);
        }
      }
    });

    // Print action items if any
    if (showActions && actionItems.length > 0) {
      console.log('Suggested Actions:');
      actionItems.forEach(item => console.log(item));
    }

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

main();
