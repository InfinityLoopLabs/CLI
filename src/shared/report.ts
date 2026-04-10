import path from "node:path";

export function toRelativeLogPath(cwd: string, absolutePath: string): string {
  const relative = path.relative(cwd, absolutePath);
  if (!relative) {
    return ".";
  }
  return relative.replace(/\\/g, "/");
}

export function compactMessages(messages: string[], maxItems = 30): string[] {
  if (messages.length <= maxItems) {
    return messages;
  }

  const hiddenCount = messages.length - maxItems;
  return [...messages.slice(0, maxItems), `... ${hiddenCount} more item(s)`];
}
