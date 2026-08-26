#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { randomUUID } from 'node:crypto';

const FOOTMAN_BASE = 'http://localhost:6112';
const FOOTMAN_URL = `${FOOTMAN_BASE}/notify`;

// The notification body sent to the widget. These calls carry no session id —
// the widget's session bookkeeping comes from the hooks — so the message names
// itself instead: the working directory tells the widget which project this is,
// and `agent` names whoever is calling, so a named subagent is labelled
// "project · agent" rather than appearing out of nowhere.
export function buildNotifyBody(type, message, { options = null, promptId = null, agent = null, cwd } = {}) {
  return {
    type,
    message,
    options,
    promptId,
    cwd: cwd ?? process.cwd(),
    name: typeof agent === 'string' && agent.trim() !== '' ? agent.trim() : null,
  };
}

// Send notification to Footman widget
async function notifyFootman(type, message, opts = {}) {
  try {
    const response = await fetch(FOOTMAN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildNotifyBody(type, message, opts))
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

// Poll the widget for the user's answer to a prompt
async function waitForResponse(promptId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${FOOTMAN_BASE}/response/${promptId}`);
      if (res.ok) {
        const { choice } = await res.json();
        return choice;
      }
    } catch {
      // Widget restarting or unreachable — keep polling until deadline
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return null;
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
            agent: {
              type: 'string',
              description: 'Optional: your name, if you are a named agent — shown beside the project',
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
            agent: {
              type: 'string',
              description: 'Optional: your name, if you are a named agent — shown beside the project',
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
            agent: {
              type: 'string',
              description: 'Optional: your name, if you are a named agent — shown beside the project',
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
            agent: {
              type: 'string',
              description: 'Optional: your name, if you are a named agent — shown beside the project',
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
      await notifyFootman('task_complete', args.message, { agent: args.agent });
      return {
        content: [
          {
            type: 'text',
            text: `Footman notified: ${args.message}`,
          },
        ],
      };

    case 'footman_notify_working':
      await notifyFootman('task_working', args.message, { agent: args.agent });
      return {
        content: [
          {
            type: 'text',
            text: `Footman working: ${args.message}`,
          },
        ],
      };

    case 'footman_notify_error':
      await notifyFootman('error', args.message, { agent: args.agent });
      return {
        content: [
          {
            type: 'text',
            text: `Footman error: ${args.message}`,
          },
        ],
      };

    case 'footman_prompt': {
      const promptId = randomUUID();
      const sent = await notifyFootman('prompt', args.question, { options: args.options, promptId, agent: args.agent });

      if (!sent) {
        return {
          content: [
            { type: 'text', text: 'Footman widget is not running — prompt could not be shown.' },
          ],
        };
      }

      // Poll for the user's click, up to 5 minutes
      const choice = await waitForResponse(promptId, 5 * 60 * 1000);

      if (choice === null) {
        return {
          content: [
            { type: 'text', text: `No response from user (timed out after 5 minutes): ${args.question}` },
          ],
        };
      }

      return {
        content: [
          { type: 'text', text: `User selected: ${choice}` },
        ],
      };
    }

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

// Only start the stdio transport when run directly — importing this file for
// tests must not open a connection, the same guard the hook scripts use.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
