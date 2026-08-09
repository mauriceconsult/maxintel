import { resolve} from "path";
import { readFile, writeFile} from "fs/promises";
import { tool } from "ai";
import { z } from "zod";


export function createEditFileTool(cwd: string) {
  return tool({
    description:
      "Make a targeted edit to a file by replacing an exact string match. The oldString must appear exactly once in the file (for safety). Use this for surgical edits instead of rotating entire files",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file to edit"),
      oldString: z
        .string()
        .describe("The exact text to find and replace (must be unique in the file)"),
      newString: z.string().describe("The text to replace it with"),
    }),
      
    execute: async ({ path, oldString, newString }) => {
      const resolved = resolve(cwd, path);
      if (!resolved.startsWith(cwd)) {
        return { error: "Path is outside the project directory" };
      }
      try { 
        const content = await readFile(resolved, "utf-8");
        const occurences = content.split(oldString).length - 1;
        if (occurences === 0) {
          return {error: "oldString not found in the file"}
        }
        if (occurences > 1) {
          return {
            error: `oldString is ambiguous - found ${occurences} matches. Provide more sorrounding context to make it unique.`,
          };         
        } const updated = content.replace(oldString, newString);
        await writeFile(resolved, updated, "utf-8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to edit file: ${message}` };
       };
    },
  });
}
