#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const FOOTMAN_URL = 'http://localhost:3000/notify';

// Send notification to Footman widget
async function notifyFootman(type, message, options = null) {
  try {
    const response = await fetch(FOOTMAN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message, options })
    });

    if (!response.ok) {
      console.error('Footman notification failed:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to notify Footman:', error.message);
    return false;
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'footman-notifier',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool: Notify task completion
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'footman_notify_complete',
        description: 'Notify the Footman widget that a task has been completed',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The completion message to display',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'footman_notify_working',
        description: 'Notify the Footman widget that work is in progress',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The work description to display',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'footman_notify_error',
        description: 'Notify the Footman widget that an error occurred',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The error message to display',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'footman_prompt',
        description: 'Ask the user a question via the Footman widget',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The question to ask',
            },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of answer options',
            },
          },
          required: ['question', 'options'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'footman_notify_complete':
      await notifyFootman('task_complete', args.message);
      return {
        content: [
          {
            type: 'text',
            text: `Footman notified: ${args.message}`,
          },
        ],
      };

    case 'footman_notify_working':
      await notifyFootman('task_working', args.message);
      return {
        content: [
          {
            type: 'text',
            text: `Footman working: ${args.message}`,
          },
        ],
      };

    case 'footman_notify_error':
      await notifyFootman('error', args.message);
      return {
        content: [
          {
            type: 'text',
            text: `Footman error: ${args.message}`,
          },
        ],
      };

    case 'footman_prompt':
      await notifyFootman('prompt', args.question, args.options);
      return {
        content: [
          {
            type: 'text',
            text: `Footman prompt: ${args.question}`,
          },
        ],
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Footman MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
