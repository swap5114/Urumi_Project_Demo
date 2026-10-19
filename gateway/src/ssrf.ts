import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Always blocked, no exceptions: cloud metadata (169.254.0.0/16), loopback, unspecified.
function isAlwaysBlocked(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fe80:") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:169.254.");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 127 || a === 0 || (a === 169 && b === 254);
}

// Private (RFC1918 / ULA) ranges: blocked unless the host is explicitly allowed.
function isPrivate(ip: string): boolean {
  if (ip.includes(":")) return /^f[cd]/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// ALLOWED_INTERNAL_HOSTS="woocommerce-mcp,*.svc.cluster.local" (set from Helm values)
function hostAllowed(host: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p));
}

export async function assertSafeUpstreamUrl(
  raw: string,
  allowedInternal = (process.env.ALLOWED_INTERNAL_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
): Promise<URL> {
  const url = new URL(raw); // throws on garbage
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http/https URLs allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // Resolve DNS ourselves and check EVERY address the name points to.
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addrs) {
    if (isAlwaysBlocked(address)) throw new Error(`blocked address ${address}`);
    if (isPrivate(address) && !hostAllowed(host, allowedInternal)) {
      throw new Error(`private address ${address} not allowed for host "${host}"`);
    }
  }
  return url;
}
