import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductivePerson, ProductiveProject } from '../api/types.js';

const getPageSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
});

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
