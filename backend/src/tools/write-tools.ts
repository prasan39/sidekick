import { approvalManager } from '../approval-manager.js';

// Tool definitions for actions that require approval
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

export const writeTools: ToolDefinition[] = [
  {
    name: 'send_email',
    description: 'Send an email to a recipient. Requires user approval before sending.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Email recipient address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content' },
        cc: { type: 'string', description: 'CC recipients (comma-separated)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'create_event',
    description: 'Create a calendar event. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start time (ISO 8601)' },
        end: { type: 'string', description: 'End time (ISO 8601)' },
        attendees: { type: 'string', description: 'Attendee emails (comma-separated)' },
        location: { type: 'string', description: 'Event location' },
        description: { type: 'string', description: 'Event description' },
      },
      required: ['title', 'start', 'end'],
    },
  },
  {
    name: 'send_teams_message',
    description: 'Send a message in Microsoft Teams. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Teams channel name' },
        user: { type: 'string', description: 'User to message directly' },
        message: { type: 'string', description: 'Message content' },
      },
      required: ['message'],
    },
  },
  {
    name: 'upload_file',
    description: 'Upload a file to OneDrive or SharePoint. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Name for the uploaded file' },
        content: { type: 'string', description: 'File content' },
        destination: { type: 'string', description: 'Destination path in OneDrive/SharePoint' },
      },
      required: ['filename', 'content'],
    },
  },
];

// Memory tools (no approval needed)
export const memoryTools: ToolDefinition[] = [
  {
    name: 'remember',
    description: 'Save an important fact to long-term memory. Use this when the user asks you to remember something or when you learn important information about the user.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'The fact to remember' },
        category: {
          type: 'string',
          description: 'Category for the fact',
          enum: ['User Profile', 'Preferences', 'Current Projects', 'Key Contacts', 'Important Dates', 'Notes'],
        },
      },
      required: ['fact'],
    },
  },
  {
    name: 'forget',
    description: 'Remove outdated or incorrect information from memory.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'The fact or keyword to forget' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'recall',
    description: 'Search memory for relevant information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for memory' },
      },
      required: ['query'],
    },
  },
];

// Generate preview text for approval UI
export function generatePreview(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'send_email':
      return `
**To:** ${args.to}
${args.cc ? `**CC:** ${args.cc}` : ''}
**Subject:** ${args.subject}

---

${args.body}
`.trim();

    case 'create_event':
      return `
**Event:** ${args.title}
**When:** ${args.start} - ${args.end}
${args.location ? `**Location:** ${args.location}` : ''}
${args.attendees ? `**Attendees:** ${args.attendees}` : ''}
${args.description ? `\n---\n${args.description}` : ''}
`.trim();

    case 'send_teams_message':
      return `
**To:** ${args.channel ? `#${args.channel}` : args.user}

---

${args.message}
`.trim();

    case 'upload_file':
      return `
**File:** ${args.filename}
**Destination:** ${args.destination || 'OneDrive root'}
**Size:** ${(args.content as string)?.length || 0} characters
`.trim();

    default:
      return JSON.stringify(args, null, 2);
  }
}

// Execute a write tool with approval
export async function executeWriteTool(
  tool: string,
  args: Record<string, unknown>
): Promise<{ pending: true; approvalId: string; preview: string } | { success: boolean; result: string }> {
  const preview = generatePreview(tool, args);

  // Request approval
  const approved = await approvalManager.requestApproval(tool, args, preview);

  if (!approved) {
    return {
      success: false,
      result: 'Action was denied or expired.',
    };
  }

  // Execute the action (in a real implementation, this would call M365 APIs)
  // For now, we simulate success
  return {
    success: true,
    result: `${tool} executed successfully`,
  };
}

// Check if a tool requires approval
export function requiresApproval(toolName: string): boolean {
  return writeTools.some(t => t.name === toolName);
}
