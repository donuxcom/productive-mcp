import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../api/client.js';

// --- get_task_attachments ---

const getTaskAttachmentsSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
});

export async function getTaskAttachmentsTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getTaskAttachmentsSchema.parse(args);

    const response = await client.listAttachments({ task_id: params.task_id });

    if (!response.data || response.data.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No attachments found for task ${params.task_id}.`,
        }],
      };
    }

    const attachmentsText = response.data.map((attachment) => {
      let text = `• ${attachment.attributes.name || 'Unnamed'} (ID: ${attachment.id})`;
      if (attachment.attributes.content_type) {
        text += `\n  Type: ${attachment.attributes.content_type}`;
      }
      if (attachment.attributes.size) {
        const sizeKB = (attachment.attributes.size / 1024).toFixed(1);
        text += `\n  Size: ${sizeKB} KB`;
      }
      if (attachment.attributes.url) {
        text += `\n  URL: ${attachment.attributes.url}`;
      }
      if (attachment.attributes.created_at) {
        text += `\n  Uploaded: ${attachment.attributes.created_at}`;
      }
      return text;
    }).join('\n\n');

    const summary = `Found ${response.data.length} attachment${response.data.length !== 1 ? 's' : ''} for task ${params.task_id}:\n\n${attachmentsText}`;

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

export const getTaskAttachmentsDefinition = {
  name: 'get_task_attachments',
  description: 'Get the list of attachments for a specific task in Productive.io.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to get attachments for (required)',
      },
    },
    required: ['task_id'],
  },
};

// --- get_attachment_content ---

const TEXT_CONTENT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/octet-stream', // Often used for .md, .txt etc.
];

const TEXT_FILE_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.js', '.ts', '.py', '.rb', '.sh', '.bash',
  '.css', '.scss', '.less', '.sql', '.log', '.env', '.ini', '.cfg',
  '.toml', '.conf', '.properties',
];

function isTextContentType(contentType?: string): boolean {
  if (!contentType) return false;
  return TEXT_CONTENT_TYPES.some(t => contentType.startsWith(t));
}

function isTextFileName(name?: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

const getAttachmentContentSchema = z.object({
  attachment_id: z.string().min(1, 'Attachment ID is required'),
});

export async function getAttachmentContentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getAttachmentContentSchema.parse(args);

    const response = await client.getAttachment(params.attachment_id);
    const attachment = response.data;

    const name = attachment.attributes.name || 'Unnamed';
    const contentType = attachment.attributes.content_type;

    let text = `Attachment: ${name} (ID: ${attachment.id})\n`;
    if (contentType) {
      text += `Content-Type: ${contentType}\n`;
    }
    if (attachment.attributes.size) {
      const sizeKB = (attachment.attributes.size / 1024).toFixed(1);
      text += `Size: ${sizeKB} KB\n`;
    }
    if (attachment.attributes.created_at) {
      text += `Uploaded: ${attachment.attributes.created_at}\n`;
    }

    // Determine if this is a text file by content_type OR file extension
    const likelyText = isTextContentType(contentType) || isTextFileName(name);

    if (likelyText) {
      try {
        // fetchAttachmentContent ri-fetcha l'attachment per URL fresco
        const result = await client.fetchAttachmentContent(attachment.id);

        if (result.ok) {
          text += `\n--- Content ---\n${result.text}`;
        } else {
          text += `\n${result.text}`;
        }
      } catch (fetchError) {
        const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        text += `\nCould not fetch content: ${errMsg}`;
      }
    } else {
      const url = attachment.attributes.url;
      text += `\nThis is a binary file. Download URL: ${url || 'not available'}`;
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

export const getAttachmentContentDefinition = {
  name: 'get_attachment_content',
  description: 'Get the content of a specific attachment. For text files (txt, markdown, csv, json, etc.), returns the file content. For binary files, returns metadata and download URL.',
  inputSchema: {
    type: 'object',
    properties: {
      attachment_id: {
        type: 'string',
        description: 'ID of the attachment to retrieve (required)',
      },
    },
    required: ['attachment_id'],
  },
};
