export interface Attachment {
  name: string;
  text: string;
}

// All attached files together, so one message stays well under the server's body limit.
export const MAX_ATTACHMENT_CHARS = 200_000;

export type CommandId = "new" | "search" | "pin" | "delete";

export interface Command {
  id: CommandId;
  name: string;
  help: string;
}

export const COMMANDS: Command[] = [
  { id: "new", name: "/new", help: "Start a new chat" },
  { id: "search", name: "/search", help: "Search your chats" },
  { id: "pin", name: "/pin", help: "Pin or unpin the current chat" },
  { id: "delete", name: "/delete", help: "Delete the current chat" },
];

// Commands are offered while the draft is a single word that starts with "/".
export function matchingCommands(draft: string): Command[] {
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  return COMMANDS.filter((command) => command.name.startsWith(draft.toLowerCase()));
}

// A fence longer than any backtick run in the text, so the text cannot close its own block.
export function fenceFor(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

// Each attachment reaches the model inline as a fenced block, ahead of the typed text.
export function buildContent(text: string, attachments: Attachment[]): string {
  const parts = attachments.map((attachment) => {
    const fence = fenceFor(attachment.text);
    return `Attached file: ${attachment.name}\n${fence}\n${attachment.text}\n${fence}`;
  });
  if (text) parts.push(text);
  return parts.join("\n\n");
}

export function attachedChars(attachments: Attachment[]): number {
  return attachments.reduce((total, attachment) => total + attachment.text.length, 0);
}
