import type { Tool } from "@modelcontextprotocol/client";
import type { ServerPublic, createRegistry } from "./registry.js";
import type { createUpstream } from "./upstream.js";

type Registry = ReturnType<typeof createRegistry>;
type Upstream = ReturnType<typeof createUpstream>;

// Slugs can never contain "_" (see the CHECK in db.ts), so the FIRST "__" is always the separator.
export const SEP = "__";
const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/; // what most MCP clients accept for tool names
const MAX_DESCRIPTION = 1000;

export interface ServerReport {
  slug: string;
  ok: boolean;
  toolCount: number;
  reason?: string;
}

export function prefixName(slug: string, tool: string): string {
  return `${slug}${SEP}${tool}`;
}

export function parseName(name: string): { slug: string; tool: string } | undefined {
  const i = name.indexOf(SEP);
  if (i <= 0 || i + SEP.length >= name.length) return undefined;
  return { slug: name.slice(0, i), tool: name.slice(i + SEP.length) };
}

export function createAggregator(registry: Registry, upstream: Upstream) {
  return {
    // Ask every ENABLED server in parallel; a slow or dead one only removes its own tools.
    async listAllTools(): Promise<{ tools: Tool[]; servers: ServerReport[] }> {
      const enabled = registry.list().filter((s) => s.enabled);
      const settled = await Promise.allSettled(enabled.map((s) => upstream.listTools(s.id)));

      const tools: Tool[] = [];
      const servers: ServerReport[] = [];
      settled.forEach((res, i) => {
        const slug = enabled[i].slug;
        if (res.status === "rejected") {
          servers.push({ slug, ok: false, toolCount: 0, reason: String(res.reason).slice(0, 200) });
        } else if (!res.value.ok) {
          servers.push({ slug, ok: false, toolCount: 0, reason: res.value.reason });
        } else {
          let count = 0;
          for (const t of res.value.tools) {
            const name = prefixName(slug, t.name);
            if (!VALID_NAME.test(name)) { console.warn(`skipping tool "${name}": invalid or too long`); continue; }
            const desc = (t.description ?? "").slice(0, MAX_DESCRIPTION); // upstream text is untrusted; cap its size
            tools.push({ ...t, name, description: `[${slug}] ${desc}` });
            count++;
          }
          servers.push({ slug, ok: true, toolCount: count });
        }
      });
      return { tools, servers };
    },

    // Used by tools/call (step 6): "woo__list_orders" -> server + original tool name.
    // Disabled servers do not resolve, so a hidden tool is also rejected if called directly.
    route(prefixed: string): { server: ServerPublic; tool: string } | undefined {
      const parsed = parseName(prefixed);
      if (!parsed) return undefined;
      const server = registry.list().find((s) => s.slug === parsed.slug && s.enabled);
      return server ? { server, tool: parsed.tool } : undefined;
    },
  };
}
