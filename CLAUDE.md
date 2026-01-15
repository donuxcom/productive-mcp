# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that enables Claude Desktop, Claude Code, and other MCP-compatible clients to interact with the Productive.io API. It's a TypeScript project that runs as a CLI tool.

## Development Commands

```bash
npm run build     # Compile TypeScript to build/
npm run dev       # Watch mode for development
npm start         # Run the built server
```

## Architecture

### Core Structure

```
src/
├── index.ts           # Entry point - creates and starts server
├── server.ts          # MCP server setup, tool/prompt registration
├── config/index.ts    # Zod-validated environment configuration
├── api/
│   ├── client.ts      # ProductiveAPIClient - all API interactions
│   └── types.ts       # TypeScript interfaces for API entities
├── tools/             # Individual MCP tool implementations
└── prompts/           # MCP prompt templates
```

### Key Patterns

**Tool Registration**: Each tool file exports:
- A Zod schema for input validation
- A tool definition object (name, description, inputSchema)
- A handler function that receives (apiClient, args, config?)

**API Client**: `ProductiveAPIClient` centralizes all Productive.io API calls with:
- Automatic header injection (auth token, org ID)
- JSON:API format compliance (`application/vnd.api+json`)
- Typed responses using generics

**Configuration**: Environment variables are validated at startup using Zod:
- `PRODUCTIVE_API_TOKEN` (required)
- `PRODUCTIVE_ORG_ID` (required)
- `PRODUCTIVE_USER_ID` (optional - enables "me" context)

### Productive.io Data Hierarchy

The API follows this hierarchy: **Companies → Projects → Boards → Task Lists → Tasks**

When creating tasks, you typically need IDs from parent entities.

## Adding New Tools

1. Create a new file in `src/tools/`
2. Define Zod schema for inputs
3. Export tool definition and handler function
4. Import and register in `src/server.ts` (add to ListToolsRequestSchema handler and CallToolRequestSchema switch)

## Notes

- The server uses stdio transport for MCP communication
- stdout must remain clean for MCP protocol - use stderr for debugging
- All API entity types use JSON:API format with `data`, `attributes`, `relationships` structure
