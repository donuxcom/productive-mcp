import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveTaskUpdate } from '../api/types.js';

const listTasksSchema = z.object({
  project_id: z.string().optional(),
  assignee_id: z.string().optional(),
  status: z.enum(['open', 'closed']).optional(),
  limit: z.number().min(1).max(200).default(30).optional(),
  top_level_only: z.boolean().optional(),
});

const getProjectTasksSchema = z.object({
  project_id: z.string().min(1, 'Project ID is required'),
  status: z.enum(['open', 'closed']).optional(),
  top_level_only: z.boolean().optional(),
});

const getTaskSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
});

export async function listTasksTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listTasksSchema.parse(args || {});
    
    const response = await client.listTasks({
      project_id: params.project_id,
      assignee_id: params.assignee_id,
      status: params.status,
      limit: params.limit,
      include: ['assignee', 'parent_task'],
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No tasks found matching the criteria.',
        }],
      };
    }

    // Build a map of person IDs to names from included data
    const personMap = new Map<string, string>();
    // Build a map of task IDs to titles for parent tasks
    const taskTitleMap = new Map<string, string>();
    if (response.included && Array.isArray(response.included)) {
      response.included.forEach((item: any) => {
        if (item.type === 'people') {
          const firstName = item.attributes.first_name || '';
          const lastName = item.attributes.last_name || '';
          const fullName = `${firstName} ${lastName}`.trim();
          if (fullName) {
            personMap.set(item.id, fullName);
          }
        } else if (item.type === 'tasks') {
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
            ? 'No top-level tasks found matching the criteria (all tasks are subtasks).'
            : 'No tasks found matching the criteria.',
        }],
      };
    }

    const tasksText = filteredTasks.map(task => {
      const projectId = task.relationships?.project?.data?.id;
      const assigneeId = task.relationships?.assignee?.data?.id;
      const parentTaskId = task.relationships?.parent_task?.data?.id;
      const assigneeName = assigneeId ? personMap.get(assigneeId) : undefined;
      const parentTaskTitle = parentTaskId ? taskTitleMap.get(parentTaskId) : undefined;
      const statusText = task.attributes.status === 1 ? 'open' : task.attributes.status === 2 ? 'closed' : `status ${task.attributes.status}`;
      const taskType = parentTaskId ? `Subtask of: ${parentTaskTitle || parentTaskId}` : 'Top-level task';
      return `• ${task.attributes.title} (ID: ${task.id})
  Status: ${statusText}
  Type: ${taskType}
  ${task.attributes.due_date ? `Due: ${task.attributes.due_date}` : 'No due date'}
  ${projectId ? `Project ID: ${projectId}` : ''}
  ${assigneeId ? `Assignee: ${assigneeName || 'Unknown'} (ID: ${assigneeId})` : 'Unassigned'}
  ${task.attributes.description ? `Description: ${task.attributes.description}` : ''}`;
    }).join('\n\n');

    const filterNote = params.top_level_only ? ' (top-level only)' : '';
    const summary = `Found ${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''}${filterNote}${response.meta?.total_count ? ` (from ${response.meta.total_count} total)` : ''}:\n\n${tasksText}`;
    
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

export async function getProjectTasksTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getProjectTasksSchema.parse(args);
    
    const response = await client.listTasks({
      project_id: params.project_id,
      status: params.status,
      limit: 200, // Get maximum tasks for a project
      include: ['assignee', 'parent_task'],
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No tasks found for project ${params.project_id}.`,
        }],
      };
    }

    // Build a map of person IDs to names from included data
    const personMap = new Map<string, string>();
    // Build a map of task IDs to titles for parent tasks
    const taskTitleMap = new Map<string, string>();
    if (response.included && Array.isArray(response.included)) {
      response.included.forEach((item: any) => {
        if (item.type === 'people') {
          const firstName = item.attributes.first_name || '';
          const lastName = item.attributes.last_name || '';
          const fullName = `${firstName} ${lastName}`.trim();
          if (fullName) {
            personMap.set(item.id, fullName);
          }
        } else if (item.type === 'tasks') {
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
            ? `No top-level tasks found for project ${params.project_id} (all tasks are subtasks).`
            : `No tasks found for project ${params.project_id}.`,
        }],
      };
    }

    const tasksText = filteredTasks.map(task => {
      const assigneeId = task.relationships?.assignee?.data?.id;
      const parentTaskId = task.relationships?.parent_task?.data?.id;
      const assigneeName = assigneeId ? personMap.get(assigneeId) : undefined;
      const parentTaskTitle = parentTaskId ? taskTitleMap.get(parentTaskId) : undefined;
      const statusText = task.attributes.status === 1 ? 'open' : task.attributes.status === 2 ? 'closed' : `status ${task.attributes.status}`;
      const taskType = parentTaskId ? `Subtask of: ${parentTaskTitle || parentTaskId}` : 'Top-level task';
      return `• ${task.attributes.title} (ID: ${task.id})
  Status: ${statusText}
  Type: ${taskType}
  ${task.attributes.due_date ? `Due: ${task.attributes.due_date}` : 'No due date'}
  ${assigneeId ? `Assignee: ${assigneeName || 'Unknown'} (ID: ${assigneeId})` : 'Unassigned'}
  ${task.attributes.description ? `Description: ${task.attributes.description}` : ''}`;
    }).join('\n\n');

    const filterNote = params.top_level_only ? ' (top-level only)' : '';
    const summary = `Project ${params.project_id} has ${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''}${filterNote}:\n\n${tasksText}`;
    
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

export async function getTaskTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getTaskSchema.parse(args);
    
    // Import and use config directly
    const config = await import('../config/index.js').then(m => m.getConfig());
    
    // Create URL with task_list, assignee, and parent_task included
    const url = `${config.PRODUCTIVE_API_BASE_URL}tasks/${params.task_id}?include=task_list,assignee,parent_task`;
    
    // Create request with proper headers from config
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Auth-Token': config.PRODUCTIVE_API_TOKEN,
        'X-Organization-Id': config.PRODUCTIVE_ORG_ID,
        'Content-Type': 'application/vnd.api+json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get task: ${response.statusText}`);
    }
    
    const data = await response.json();
    const task = data.data;
    const projectId = task.relationships?.project?.data?.id;
    const assigneeId = task.relationships?.assignee?.data?.id;
    const taskListId = task.relationships?.task_list?.data?.id;
    const parentTaskId = task.relationships?.parent_task?.data?.id;
    
    // Handle status using the 'closed' field from actual API response
    const statusText = task.attributes.closed === false ? 'open' : task.attributes.closed === true ? 'closed' : 'unknown';
    
    let text = `Task Details:\n\n`;
    text += `Title: ${task.attributes.title}\n`;
    text += `ID: ${task.id}\n`;
    text += `Status: ${statusText}\n`;
    
    if (task.attributes.description) {
      text += `Description: ${task.attributes.description}\n`;
    }
    
    if (task.attributes.due_date) {
      text += `Due Date: ${task.attributes.due_date}\n`;
    } else {
      text += `Due Date: No due date set\n`;
    }
    
    if (projectId) {
      text += `Project ID: ${projectId}\n`;
    }
    
    if (assigneeId) {
      text += `Assignee ID: ${assigneeId}\n`;
      // Look for assignee name in included data
      if (data.included && Array.isArray(data.included)) {
        const assignee = data.included.find((item: any) => item.type === 'people' && item.id === assigneeId);
        if (assignee) {
          const firstName = assignee.attributes.first_name || '';
          const lastName = assignee.attributes.last_name || '';
          const fullName = `${firstName} ${lastName}`.trim();
          if (fullName) {
            text += `Assignee: ${fullName}\n`;
          }
        }
      }
    } else {
      text += `Assignee: Unassigned\n`;
    }

    // Parent task info (for subtasks)
    if (parentTaskId) {
      text += `Parent Task ID: ${parentTaskId}\n`;
      // Look for parent task title in included data
      if (data.included && Array.isArray(data.included)) {
        const parentTask = data.included.find((item: any) => item.type === 'tasks' && item.id === parentTaskId);
        if (parentTask) {
          text += `Parent Task: ${parentTask.attributes.title}\n`;
        }
      }
      text += `Type: Subtask\n`;
    } else {
      text += `Type: Top-level task\n`;
    }

    if (task.attributes.created_at) {
      text += `Created: ${task.attributes.created_at}\n`;
    }
    
    if (task.attributes.updated_at) {
      text += `Updated: ${task.attributes.updated_at}\n`;
    }
    
    // Include any additional attributes that might be useful
    if (task.attributes.priority !== undefined) {
      text += `Priority: ${task.attributes.priority}\n`;
    }
    
    if (task.attributes.placement !== undefined) {
      text += `Position: ${task.attributes.placement}\n`;
    }
    
    // Add useful additional fields from actual API response
    if (task.attributes.task_number) {
      text += `Task Number: ${task.attributes.task_number}\n`;
    }
    
    if (task.attributes.private !== undefined) {
      text += `Private: ${task.attributes.private ? 'Yes' : 'No'}\n`;
    }
    
    if (task.attributes.initial_estimate) {
      text += `Initial Estimate: ${task.attributes.initial_estimate}\n`;
    }
    
    if (task.attributes.worked_time) {
      text += `Worked Time: ${task.attributes.worked_time}\n`;
    }
    
    if (task.attributes.last_activity_at) {
      text += `Last Activity: ${task.attributes.last_activity_at}\n`;
    }
    
    // Include task list ID information if available
    if (taskListId) {
      text += `Task List ID: ${taskListId}\n`;
      
    // If there's included data for the task list, include the name
    console.log('Included data:', JSON.stringify(data.included));
    if (data.included && Array.isArray(data.included)) {
      const taskList = data.included.find((item: any) => item.type === 'task_lists' && item.id === taskListId);
      if (taskList) {
        text += `Task List: ${taskList.attributes.name}\n`;
      }
    }
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

export const listTasksDefinition = {
  name: 'list_tasks',
  description: 'Get a list of tasks from Productive.io. Returns task hierarchy info (parent task) and can filter to show only top-level tasks.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Filter tasks by project ID',
      },
      assignee_id: {
        type: 'string',
        description: 'Filter tasks by assignee ID',
      },
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
        description: 'If true, only return top-level tasks (exclude subtasks). Default: false (return all tasks including subtasks)',
      },
    },
  },
};

export const getProjectTasksDefinition = {
  name: 'get_project_tasks',
  description: 'Get all tasks for a specific project. Returns task hierarchy info (parent task) and can filter to show only top-level tasks. ALSO used as STEP 4 in timesheet workflow to find task_id for linking time entries to specific tasks. Workflow: list_projects → list_project_deals → list_deal_services → get_project_tasks → create_time_entry.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'The ID of the project',
      },
      status: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Filter by task status (open or closed)',
      },
      top_level_only: {
        type: 'boolean',
        description: 'If true, only return top-level tasks (exclude subtasks). Default: false (return all tasks including subtasks)',
      },
    },
    required: ['project_id'],
  },
};

export const getTaskDefinition = {
  name: 'get_task',
  description: 'Get detailed information about a specific task by ID',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The ID of the task to retrieve',
      },
    },
    required: ['task_id'],
  },
};

const createTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional(),
  project_id: z.string().optional(),
  board_id: z.string().optional(),
  task_list_id: z.string().optional(),
  assignee_id: z.string().optional(),
  due_date: z.string().optional(),
  status: z.enum(['open', 'closed']).optional().default('open'),
  type_id: z.number().min(1).max(2).optional(),
  parent_task_id: z.string().optional(),
});

export async function createTaskTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createTaskSchema.parse(args || {});
    
    // Handle "me" reference for assignee
    let assigneeId = params.assignee_id;
    if (assigneeId === 'me') {
      if (!config?.PRODUCTIVE_USER_ID) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Cannot use "me" reference - PRODUCTIVE_USER_ID is not configured in environment'
        );
      }
      assigneeId = config.PRODUCTIVE_USER_ID;
    }
    
    const taskData = {
      data: {
        type: 'tasks' as const,
        attributes: {
          title: params.title,
          description: params.description,
          due_date: params.due_date,
          status: params.status === 'open' ? 1 : 2,
          ...(params.type_id !== undefined && { type_id: params.type_id }),
        },
        relationships: {} as any,
      },
    };
    
    // Add relationships if provided
    if (params.project_id) {
      taskData.data.relationships.project = {
        data: {
          id: params.project_id,
          type: 'projects' as const,
        },
      };
    }
    
    if (params.board_id) {
      taskData.data.relationships.board = {
        data: {
          id: params.board_id,
          type: 'boards' as const,
        },
      };
    }
    
    if (params.task_list_id) {
      taskData.data.relationships.task_list = {
        data: {
          id: params.task_list_id,
          type: 'task_lists' as const,
        },
      };
    }
    
    if (assigneeId) {
      taskData.data.relationships.assignee = {
        data: {
          id: assigneeId,
          type: 'people' as const,
        },
      };
    }

    if (params.parent_task_id) {
      taskData.data.relationships.parent_task = {
        data: {
          id: params.parent_task_id,
          type: 'tasks' as const,
        },
      };
    }

    const response = await client.createTask(taskData);
    
    const isMilestone = params.type_id === 2;
    const isSubtask = !!params.parent_task_id;
    const typeLabel = isMilestone ? 'Milestone' : (isSubtask ? 'Subtask' : 'Task');
    let text = `${typeLabel} created successfully!\n`;
    text += `Title: ${response.data.attributes.title} (ID: ${response.data.id})`;
    text += `\nType: ${typeLabel}`;
    if (isSubtask) {
      text += `\nParent Task ID: ${params.parent_task_id}`;
    }
    if (response.data.attributes.description) {
      text += `\nDescription: ${response.data.attributes.description}`;
    }
    const statusText = response.data.attributes.status === 1 ? 'open' : 'closed';
    text += `\nStatus: ${statusText}`;
    if (response.data.attributes.due_date) {
      text += `\nDue date: ${response.data.attributes.due_date}`;
    }
    if (params.project_id) {
      text += `\nProject ID: ${params.project_id}`;
    }
    if (params.board_id) {
      text += `\nBoard ID: ${params.board_id}`;
    }
    if (params.task_list_id) {
      text += `\nTask List ID: ${params.task_list_id}`;
    }
    if (assigneeId) {
      text += `\nAssignee ID: ${assigneeId}`;
      if (params.assignee_id === 'me' && config?.PRODUCTIVE_USER_ID) {
        text += ` (me)`;
      }
    }
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

export const createTaskDefinition = {
  name: 'create_task',
  description: 'Create a new task or milestone in Productive.io. If PRODUCTIVE_USER_ID is configured, you can use "me" to refer to the configured user when assigning.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Task title (required)',
      },
      description: {
        type: 'string',
        description: 'Task description',
      },
      project_id: {
        type: 'string',
        description: 'ID of the project to add the task to',
      },
      board_id: {
        type: 'string',
        description: 'ID of the board to add the task to',
      },
      task_list_id: {
        type: 'string',
        description: 'ID of the task list to add the task to',
      },
      assignee_id: {
        type: 'string',
        description: 'ID of the person to assign the task to. If PRODUCTIVE_USER_ID is configured in environment, "me" refers to that user.',
      },
      due_date: {
        type: 'string',
        description: 'Due date in YYYY-MM-DD format',
      },
      status: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Task status (default: open)',
      },
      type_id: {
        type: 'number',
        description: 'Task type: 1 = regular task (default), 2 = milestone',
        enum: [1, 2],
      },
      parent_task_id: {
        type: 'string',
        description: 'ID of the parent task to create this as a subtask',
      },
    },
    required: ['title'],
  },
};

const updateTaskAssignmentSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
  assignee_id: z.string().describe('ID of the person to assign (use "null" string to unassign)'),
});

export async function updateTaskAssignmentTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updateTaskAssignmentSchema.parse(args);
    
    // Handle "me" reference and "null" string
    let assigneeId: string | null = params.assignee_id;
    if (assigneeId === 'me') {
      if (!config?.PRODUCTIVE_USER_ID) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Cannot use "me" reference - PRODUCTIVE_USER_ID is not configured in environment'
        );
      }
      assigneeId = config.PRODUCTIVE_USER_ID;
    } else if (assigneeId === 'null') {
      assigneeId = null;
    }
    
    const taskUpdate: ProductiveTaskUpdate = {
      data: {
        type: 'tasks',
        id: params.task_id,
        relationships: assigneeId ? {
          assignee: {
            data: {
              id: assigneeId,
              type: 'people'
            }
          }
        } : {
          assignee: {
            data: null
          }
        }
      }
    };
    
    const response = await client.updateTask(params.task_id, taskUpdate);
    
    let text = `Task assignment updated successfully!\n`;
    text += `Task: ${response.data.attributes.title} (ID: ${response.data.id})\n`;
    
    if (assigneeId) {
      text += `Assigned to: Person ID ${assigneeId}`;
      if (params.assignee_id === 'me' && config?.PRODUCTIVE_USER_ID) {
        text += ` (me)`;
      }
    } else {
      text += `Task is now unassigned`;
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

export const updateTaskAssignmentDefinition = {
  name: 'update_task_assignment',
  description: 'Update the assignee of an existing task. If PRODUCTIVE_USER_ID is configured, you can use "me" to refer to the configured user. To unassign, use "null" as a string.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to update (required)',
      },
      assignee_id: {
        type: 'string',
        description: 'ID of the person to assign the task to (use "null" string to unassign). If PRODUCTIVE_USER_ID is configured in environment, "me" refers to that user.',
      },
    },
    required: ['task_id', 'assignee_id'],
  },
};

const updateTaskDetailsSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
  title: z.string().min(1, 'Task title cannot be empty').optional(),
  description: z.string().optional(),
});

export async function updateTaskDetailsTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updateTaskDetailsSchema.parse(args);
    
    // Ensure at least one field is being updated
    if (!params.title && params.description === undefined) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'At least one field (title or description) must be provided for update'
      );
    }
    
    const taskUpdate: ProductiveTaskUpdate = {
      data: {
        type: 'tasks',
        id: params.task_id,
        attributes: {}
      }
    };
    
    // Only include fields that are being updated
    if (params.title) {
      taskUpdate.data.attributes!.title = params.title;
    }
    
    if (params.description !== undefined) {
      taskUpdate.data.attributes!.description = params.description;
    }
    
    const response = await client.updateTask(params.task_id, taskUpdate);
    
    let text = `Task details updated successfully!\n`;
    text += `Task: ${response.data.attributes.title} (ID: ${response.data.id})\n`;
    
    if (params.title) {
      text += `✓ Title updated to: "${response.data.attributes.title}"\n`;
    }
    
    if (params.description !== undefined) {
      if (response.data.attributes.description) {
        text += `✓ Description updated to: "${response.data.attributes.description}"\n`;
      } else {
        text += `✓ Description cleared\n`;
      }
    }
    
    if (response.data.attributes.updated_at) {
      text += `Updated at: ${response.data.attributes.updated_at}`;
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

export const updateTaskDetailsDefinition = {
  name: 'update_task_details',
  description: 'Update the title (name) and/or description of an existing task. At least one field must be provided.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to update (required)',
      },
      title: {
        type: 'string',
        description: 'New title/name for the task (optional, but cannot be empty if provided)',
      },
      description: {
        type: 'string',
        description: 'New description for the task (optional, use empty string to clear description)',
      },
    },
    required: ['task_id'],
  },
};
