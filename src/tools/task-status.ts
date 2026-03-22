import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveTaskUpdate } from '../api/types.js';

// Category IDs in Productive workflows
const CATEGORY_MAP: Record<string, number> = {
  'closed': 3,
  'open': 2,      // "started" category
  'not_started': 1,
};

const updateTaskStatusSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
  status: z.string().optional().describe('Status shortcut: "closed", "open", or "not_started". Resolves the correct workflow_status_id automatically.'),
  workflow_status_id: z.string().optional().describe('Explicit workflow status ID (use list_workflow_statuses to find IDs)'),
}).refine(data => data.status || data.workflow_status_id, {
  message: 'Either status or workflow_status_id must be provided',
});

async function resolveWorkflowStatusId(
  client: ProductiveAPIClient,
  taskId: string,
  statusName: string
): Promise<string> {
  const categoryId = CATEGORY_MAP[statusName];
  if (!categoryId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown status "${statusName}". Use "closed", "open", or "not_started", or provide workflow_status_id directly.`
    );
  }

  // 1. Get task's current workflow_status
  const task = await client.getTask(taskId, ['workflow_status']);
  const wsId = task.data.relationships?.workflow_status?.data?.id;
  if (!wsId) {
    throw new McpError(ErrorCode.InternalError, 'Could not determine task workflow status');
  }

  // 2. Get workflow_id from the workflow_status
  const wsStatuses = await client.listWorkflowStatuses({});
  const currentWs = wsStatuses.data.find(s => s.id === wsId);
  if (!currentWs) {
    throw new McpError(ErrorCode.InternalError, `Workflow status ${wsId} not found`);
  }

  // Find the workflow_id by fetching the specific status with workflow included
  const wsResp = await (client as any).makeRequest(`workflow_statuses/${wsId}?include=workflow`);
  const workflowId = wsResp.data?.relationships?.workflow?.data?.id;
  if (!workflowId) {
    throw new McpError(ErrorCode.InternalError, 'Could not determine workflow ID');
  }

  // 3. List all statuses in that workflow and find the one with matching category
  const workflowStatuses = await client.listWorkflowStatuses({ workflow_id: workflowId });
  const targetStatus = workflowStatuses.data.find(s => s.attributes.category_id === categoryId);
  if (!targetStatus) {
    throw new McpError(
      ErrorCode.InternalError,
      `No "${statusName}" status found in workflow ${workflowId}`
    );
  }

  return targetStatus.id;
}

export async function updateTaskStatusTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updateTaskStatusSchema.parse(args);

    let workflowStatusId = params.workflow_status_id;

    // Resolve status shortcut to workflow_status_id
    if (params.status && !workflowStatusId) {
      workflowStatusId = await resolveWorkflowStatusId(client, params.task_id, params.status);
    }

    const taskUpdate: ProductiveTaskUpdate = {
      data: {
        type: 'tasks',
        id: params.task_id,
        relationships: {
          workflow_status: {
            data: {
              id: workflowStatusId!,
              type: 'workflow_statuses',
            },
          },
        },
      },
    };

    const response = await client.updateTask(params.task_id, taskUpdate);

    let text = `Task status updated successfully!\n`;
    text += `Task: ${response.data.attributes.title} (ID: ${response.data.id})\n`;
    text += `Workflow Status ID: ${workflowStatusId}`;
    if (params.status) {
      text += ` (resolved from "${params.status}")`;
    }

    if (response.data.attributes.closed !== undefined) {
      const statusText = response.data.attributes.closed ? 'closed' : 'open';
      text += `\nActual Status: ${statusText}`;
    }

    if (response.data.attributes.updated_at) {
      text += `\nUpdated at: ${response.data.attributes.updated_at}`;
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

export const updateTaskStatusDefinition = {
  name: 'update_task_status',
  description: 'Update the status of a task. You can use a simple status string ("closed", "open", "not_started") which auto-resolves to the correct workflow status, or provide a specific workflow_status_id.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to update (required)',
      },
      status: {
        type: 'string',
        enum: ['closed', 'open', 'not_started'],
        description: 'Status shortcut: "closed", "open" (in progress), or "not_started". Auto-resolves to the correct workflow_status_id for the task\'s workflow.',
      },
      workflow_status_id: {
        type: 'string',
        description: 'Explicit workflow status ID. Takes precedence over status if both provided.',
      },
    },
    required: ['task_id'],
  },
};
