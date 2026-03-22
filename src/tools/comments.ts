import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { ProductivePerson } from '../api/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const addTaskCommentSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
  comment: z.string().min(1, 'Comment text is required'),
  hidden: z.boolean().optional(),
});

export async function addTaskCommentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = addTaskCommentSchema.parse(args);
    
    const commentData = {
      data: {
        type: 'comments' as const,
        attributes: {
          body: params.comment,
          ...(params.hidden !== undefined && { hidden: params.hidden }),
        },
        relationships: {
          task: {
            data: {
              id: params.task_id,
              type: 'tasks' as const,
            },
          },
        },
      },
    };
    
    const response = await client.createComment(commentData);
    
    let text = `Comment added successfully!\n`;
    text += `Task ID: ${params.task_id}\n`;
    text += `Comment: ${response.data.attributes.body}\n`;
    text += `Comment ID: ${response.data.id}`;
    if (response.data.attributes.created_at) {
      text += `\nCreated at: ${response.data.attributes.created_at}`;
    }
    
    return {
      content: [{
        type: 'text',
        text: text,
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

export const addTaskCommentDefinition = {
  name: 'add_task_comment',
  description: 'Add a comment to a task in Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to add the comment to (required)',
      },
      comment: {
        type: 'string',
        description: 'Text content of the comment (required)',
      },
      hidden: {
        type: 'boolean',
        description: 'Set to true to hide comment from clients (default: false, visible to all users)',
      },
    },
    required: ['task_id', 'comment'],
  },
};

// --- get_task_comments ---

const getTaskCommentsSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
});

export async function getTaskCommentsTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getTaskCommentsSchema.parse(args);

    const response = await client.listComments({ task_ids: [params.task_id] });

    if (!response.data || response.data.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No comments found for task ${params.task_id}.`,
        }],
      };
    }

    // Build person lookup map from included data
    const personMap = new Map<string, string>();
    const included = (response as any).included as Array<ProductivePerson> | undefined;
    if (included) {
      included
        .filter((item): item is ProductivePerson => item.type === 'people')
        .forEach(person => {
          const fullName = `${person.attributes.first_name} ${person.attributes.last_name}`.trim();
          personMap.set(person.id, fullName);
        });
    }

    const commentsText = response.data.map((comment) => {
      const creatorId = comment.relationships?.creator?.data?.id;
      const authorName = creatorId ? personMap.get(creatorId) || `Person ${creatorId}` : 'Unknown';
      const hiddenLabel = comment.attributes.hidden ? ' [HIDDEN]' : '';

      let text = `• Comment ${comment.id}${hiddenLabel}`;
      text += `\n  Author: ${authorName}`;
      text += `\n  Date: ${comment.attributes.created_at}`;
      text += `\n  ${comment.attributes.body}`;
      return text;
    }).join('\n\n');

    const summary = `Found ${response.data.length} comment${response.data.length !== 1 ? 's' : ''} for task ${params.task_id}:\n\n${commentsText}`;

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

export const getTaskCommentsDefinition = {
  name: 'get_task_comments',
  description: 'Get all comments for a specific task in Productive.io. Returns comments sorted by most recent first, with author names.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to get comments for (required)',
      },
    },
    required: ['task_id'],
  },
};