import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const listPeopleSchema = z.object({
  query: z.string().optional().describe('Search query to filter people by name'),
  limit: z.number().min(1).max(200).default(30).optional(),
});

export async function listPeopleTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listPeopleSchema.parse(args || {});

    const response = await client.listPeople({
      limit: params.limit,
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No people found.',
        }],
      };
    }

    // Filter by query if provided
    let people = response.data;
    if (params.query) {
      const queryLower = params.query.toLowerCase();
      people = people.filter(person => {
        const fullName = `${person.attributes.first_name} ${person.attributes.last_name}`.toLowerCase();
        const email = person.attributes.email?.toLowerCase() || '';
        return fullName.includes(queryLower) || email.includes(queryLower);
      });
    }

    if (people.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No people found matching "${params.query}".`,
        }],
      };
    }

    const peopleText = people.map(person => {
      const fullName = `${person.attributes.first_name} ${person.attributes.last_name}`.trim();
      return `• ${fullName} (ID: ${person.id})
  Email: ${person.attributes.email || 'N/A'}`;
    }).join('\n\n');

    const summary = `Found ${people.length} ${people.length !== 1 ? 'people' : 'person'}:\n\n${peopleText}`;

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

export const listPeopleDefinition = {
  name: 'list_people',
  description: 'Get a list of people from Productive.io. Use the query parameter to search by name.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to filter people by name or email',
      },
      limit: {
        type: 'number',
        description: 'Number of people to return (1-200)',
        minimum: 1,
        maximum: 200,
        default: 30,
      },
    },
  },
};
