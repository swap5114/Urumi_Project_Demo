import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { failure, textResult } from "./result.js";

interface Note {
  id: number;
  title: string;
  body: string;
  created_at: string;
}

// Notes live in memory, shared by all requests (the MCP server object itself is built per request, this array is not).
// They are lost when the pod restarts: this is a demo upstream, not a database. The cap keeps memory bounded.
const notes: Note[] = [];
let nextId = 1;
const MAX_NOTES = 200;

export function createNotesServer(): McpServer {
  const server = new McpServer({ name: "notes-mcp", version: "1.0.0" });

  server.registerTool(
    "create_note",
    {
      description: "Save a note (a title and a text). This WRITES: the note is stored on the server until it restarts.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(100).describe("Short title."),
        body: z.string().trim().min(1).max(2000).describe("The note text."),
      }),
    },
    async ({ title, body }) => {
      if (notes.length >= MAX_NOTES) return failure(`The note limit (${MAX_NOTES}) is reached.`);
      const note: Note = { id: nextId++, title, body, created_at: new Date().toISOString() };
      notes.push(note);
      return textResult({ id: note.id, title: note.title, created_at: note.created_at });
    },
  );

  server.registerTool(
    "list_notes",
    {
      description: "List saved notes, newest first. Returns id, title, creation time and the start of the text.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(10).describe("How many notes to return (1-50, default 10)."),
      }),
    },
    async ({ limit }) =>
      textResult(
        [...notes].reverse().slice(0, limit).map((n) => ({ id: n.id, title: n.title, created_at: n.created_at, preview: n.body.slice(0, 100) })),
      ),
  );

  server.registerTool(
    "get_note",
    {
      description: "Get one saved note by its id, with the full text.",
      inputSchema: z.object({ id: z.number().int().positive().describe("The note id.") }),
    },
    async ({ id }) => {
      const note = notes.find((n) => n.id === id);
      return note ? textResult(note) : failure(`No note with id ${id}.`);
    },
  );

  return server;
}
