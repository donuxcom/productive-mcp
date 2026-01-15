import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const myTasksSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  limit: z.number().min(1).max(200).default(30).optional(),
  top_level_only: z.boolean().optional(),
});

export async function myTasksTool(
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
    
    const params = myTasksSchema.parse(args || {});
    
    const response = await client.listTasks({
      assignee_id: config.PRODUCTIVE_USER_ID,
      status: params.status,
      limit: params.limit,
      include: ['parent_task'],
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'You have no tasks assigned to you.',
        }],
      };
    }

    // Build a map of task IDs to titles for parent tasks
    const taskTitleMap = new Map<string, string>();
    if (response.included && Array.isArray(response.included)) {
      response.included.forEach((item: any) => {
        if (item.type === 'tasks') {
          taskTitleMap.set(item.id, item.attributes.title);
        }
      });
    }

    // Filter tasks based on top_level_only parameter
    let filteredTasks = response.data.filter(task => task && task.attributes);
    if (params.top_level_only) {
      filteredTasks = filteredTasks.filter(task => !task.relationships?.parent_task?.data?.id);
    }

    if (filteredTasks.length === 0) {
      return {
        content: [{
          type: 'text',
          text: params.top_level_only
            ? 'You have no top-level tasks assigned to you (all your tasks are subtasks).'
            : 'You have no tasks assigned to you.',
        }],
      };
    }

    const tasksText = filteredTasks.map(task => {
      const projectId = task.relationships?.project?.data?.id;
      const parentTaskId = task.relationships?.parent_task?.data?.id;
      const parentTaskTitle = parentTaskId ? taskTitleMap.get(parentTaskId) : undefined;
      const statusIcon = task.attributes.status === 2 ? '✓' : '○';
      const statusText = task.attributes.status === 1 ? 'open' : task.attributes.status === 2 ? 'closed' : `status ${task.attributes.status}`;
      const taskType = parentTaskId ? `Subtask of: ${parentTaskTitle || parentTaskId}` : 'Top-level task';

      return `${statusIcon} ${task.attributes.title} (ID: ${task.id})
  Status: ${statusText}
  Type: ${taskType}
  ${task.attributes.due_date ? `Due: ${task.attributes.due_date}` : 'No due date'}
  ${projectId ? `Project ID: ${projectId}` : ''}
  ${task.attributes.description ? `Description: ${task.attributes.description}` : ''}`;
    }).join('\n\n');

    const filterNote = params.top_level_only ? ' (top-level only)' : '';
    const summary = `You have ${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''} assigned to you${filterNote}${response.meta?.total_count ? ` (from ${response.meta.total_count} total)` : ''}:\n\n${tasksText}`;
    
    return {
      content: [{
        type: 'text',
        text: summary,
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

export const myTasksDefinition = {
  name: 'my_tasks',
  description: 'Get tasks assigned to you (requires PRODUCTIVE_USER_ID to be configured). Returns task hierarchy info and can filter to show only top-level tasks.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Filter by task status (open or closed)',
      },
      limit: {
        type: 'number',
        description: 'Number of tasks to return (1-200)',
        minimum: 1,
        maximum: 200,
        default: 30,
      },
      top_level_only: {
        type: 'boolean',
        description: 'If true, only return top-level tasks (exclude subtasks). Useful when you want to see main tasks without nested subtasks. Default: false',
      },
    },
  },
};
