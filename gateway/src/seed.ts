import type { createRegistry } from "./registry.js";

type Registry = ReturnType<typeof createRegistry>;

// SEED_SERVERS='[{"slug":"woo","url":"http://woocommerce-mcp/mcp"}]'
// Only slug and url are accepted: a credential in an env var / Helm value would be a plaintext secret.
// Never throws: a server that cannot be seeded is logged and skipped (an admin can add it in the dashboard).
export async function seedServers(registry: Registry, raw: string | undefined): Promise<void> {
  if (!raw) return;
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    console.error("SEED_SERVERS is not valid JSON, nothing seeded");
    return;
  }
  if (!Array.isArray(list)) {
    console.error("SEED_SERVERS must be a JSON array, nothing seeded");
    return;
  }
  for (const item of list as { slug?: unknown; url?: unknown }[]) {
    const slug = String(item?.slug ?? "?");
    try {
      await registry.create({ slug: String(item.slug), url: String(item.url) });
      console.log(`seeded server: ${slug}`);
    } catch (err) {
      console.error(`seed failed for "${slug}": ${(err as Error).message}`);
    }
  }
}
