import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductivePerson, ProductiveProject, ProductivePageCreate, ProductivePageUpdate, ProseMirrorDocument, ProseMirrorNode } from '../api/types.js';

const getPageSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
});

const createPageSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().optional(),
  project_id: z.string().min(1, 'Project ID is required'),
  parent_page_id: z.string().optional(),
});

const updatePageSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
  title: z.string().optional(),
  body: z.string().optional(),
}).refine(
  (data) => data.title !== undefined || data.body !== undefined,
  { message: 'At least one of title or body must be provided' }
);

/**
 * Generate a random ID for ProseMirror paragraph nodes
 * Productive.io requires unique IDs for each paragraph
 */
function generateParagraphId(): string {
  return Math.random().toString(36).substring(2, 12);
}

/**
 * Convert plain text to ProseMirror document format
 * Each line becomes a paragraph node with a unique ID
 */
function textToProseMirror(text: string): ProseMirrorDocument {
  const lines = text.split('\n');
  const content: ProseMirrorNode[] = [];

  for (const line of lines) {
    const paragraph: ProseMirrorNode = {
      type: 'paragraph',
      attrs: {
        id: generateParagraphId(),
        horizontalAlign: null,
      },
    };

    // If line has content, add text node
    if (line.trim()) {
      paragraph.content = [{
        type: 'text',
        text: line,
      }];
    }

    content.push(paragraph);
  }

  // Ensure at least one paragraph
  if (content.length === 0) {
    content.push({
      type: 'paragraph',
      attrs: {
        id: generateParagraphId(),
        horizontalAlign: null,
      },
    });
  }

  return {
    type: 'doc',
    content,
  };
}

/**
 * Strip HTML tags from text content
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .trim();
}

export async function getPageTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getPageSchema.parse(args);

    const response = await client.getPage(params.page_id);

    if (!response || !response.data) {
      return {
        content: [{
          type: 'text',
          text: `Page ${params.page_id} not found.`,
        }],
      };
    }

    const page = response.data;
    const attrs = page.attributes;

    // Get project name from included data
    let projectName = 'Unknown Project';
    let creatorName = 'Unknown';
    const included = (response as any).included as Array<ProductiveProject | ProductivePerson> | undefined;
    if (included) {
      const project = included.find((item): item is ProductiveProject => item.type === 'projects');
      if (project) {
        projectName = project.attributes.name;
      }
      const creator = included.find((item): item is ProductivePerson => item.type === 'people');
      if (creator) {
        creatorName = `${creator.attributes.first_name} ${creator.attributes.last_name}`.trim();
      }
    }

    // Format dates
    const createdAt = new Date(attrs.created_at).toLocaleDateString();
    const updatedAt = new Date(attrs.updated_at).toLocaleDateString();

    // Format body content
    const bodyContent = attrs.body ? stripHtml(attrs.body) : 'No content';

    const output = `Page: ${attrs.title}
Project: ${projectName}
Created by: ${creatorName}
Created: ${createdAt} | Updated: ${updatedAt}

Content:
${bodyContent}`;

    return {
      content: [{
        type: 'text',
        text: output,
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

export const getPageDefinition = {
  name: 'get_page',
  description: 'Get the content of a Productive.io page/document by its ID',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'The ID of the page to retrieve',
      },
    },
    required: ['page_id'],
  },
};

export async function createPageTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createPageSchema.parse(args);

    // Build the page create request
    const pageData: ProductivePageCreate = {
      data: {
        type: 'pages',
        attributes: {
          title: params.title,
        },
        relationships: {
          project: {
            data: {
              id: params.project_id,
              type: 'projects',
            },
          },
        },
      },
    };

    // Add optional body - convert text to ProseMirror format
    if (params.body) {
      pageData.data.attributes.body = textToProseMirror(params.body);
    }

    // Handle parent page hierarchy - both parent_page_id and root_page_id must be set together
    if (params.parent_page_id) {
      pageData.data.attributes.parent_page_id = params.parent_page_id;
      pageData.data.attributes.root_page_id = params.parent_page_id;
      pageData.data.relationships.parent_page = {
        data: {
          id: params.parent_page_id,
          type: 'pages',
        },
      };
    }

    const response = await client.createPage(pageData);

    if (!response || !response.data) {
      return {
        content: [{
          type: 'text',
          text: 'Failed to create page.',
        }],
      };
    }

    const page = response.data;

    return {
      content: [{
        type: 'text',
        text: `Page created successfully!\nID: ${page.id}\nTitle: ${page.attributes.title}`,
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

export const createPageDefinition = {
  name: 'create_page',
  description: 'Create a new page/document in a Productive.io project',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Title of the page (required)',
      },
      body: {
        type: 'string',
        description: 'Content of the page (HTML format)',
      },
      project_id: {
        type: 'string',
        description: 'ID of the project to create the page in (required)',
      },
      parent_page_id: {
        type: 'string',
        description: 'ID of the parent page (for creating nested/child pages)',
      },
    },
    required: ['title', 'project_id'],
  },
};

export async function updatePageTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updatePageSchema.parse(args);

    // First, fetch the current page to get the version_number
    // This is required for optimistic concurrency control in Productive's collaborative editing system
    const currentPage = await client.getPage(params.page_id);

    if (!currentPage || !currentPage.data) {
      return {
        content: [{
          type: 'text',
          text: `Page ${params.page_id} not found.`,
        }],
      };
    }

    const currentVersion = currentPage.data.attributes.version_number;

    // Build the page update request
    const pageData: ProductivePageUpdate = {
      data: {
        type: 'pages',
        id: params.page_id,
        attributes: {},
      },
    };

    // Include version_number for optimistic concurrency control
    if (currentVersion !== undefined) {
      pageData.data.attributes!.version_number = currentVersion;
    }

    // Add fields to update
    if (params.title !== undefined) {
      pageData.data.attributes!.title = params.title;
    }
    // Convert text body to ProseMirror format
    if (params.body !== undefined) {
      pageData.data.attributes!.body = textToProseMirror(params.body);
    }

    const response = await client.updatePage(params.page_id, pageData);

    if (!response || !response.data) {
      return {
        content: [{
          type: 'text',
          text: `Failed to update page ${params.page_id}.`,
        }],
      };
    }

    const page = response.data;

    return {
      content: [{
        type: 'text',
        text: `Page updated successfully!\nID: ${page.id}\nTitle: ${page.attributes.title}\nVersion: ${page.attributes.version_number ?? 'N/A'}`,
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

export const updatePageDefinition = {
  name: 'update_page',
  description: 'Update an existing page/document in Productive.io. Note: For best results, ensure no user has the page open during update to avoid sync issues.',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'ID of the page to update (required)',
      },
      title: {
        type: 'string',
        description: 'New title for the page',
      },
      body: {
        type: 'string',
        description: 'New content for the page (HTML format)',
      },
    },
    required: ['page_id'],
  },
};
