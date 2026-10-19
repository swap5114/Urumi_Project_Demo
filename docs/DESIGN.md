# System design and tradeoffs

Short note required by the assignment. Diagrams and per-component detail are in [architecture/](architecture/README.md).

## 1. Architecture choices

| Choice | Why | What it costs |
|---|---|---|
| **Everything is a Helm chart**, one per component, values files for environments | Required. One command reproduces a component; `helm rollback` gives a safety net | Template syntax; debug with `helm template` |
| **One gateway process with two faces** (MCP server + MCP client) plus the admin API and chat agent | One thing to deploy and secure; the chat agent shares the exact tool path used by `/mcp`, so audit and routing cannot diverge | The gateway is a single point of failure and holds many responsibilities |
| **`ToolService` as the only path to an upstream** | "Nothing but the gateway talks to upstreams" is enforced in code as well as by NetworkPolicy | |
| **WooCommerce REST API** (not WP-CLI or SQL) | Official, runs WooCommerce logic, scoped revocable key, no exec into pods | OAuth 1.0a signing over HTTP; two URL settings |
| **Stateless MCP everywhere** (fresh server per request, fresh client session per call) | A dead upstream cannot poison anything; no session affinity; replicas become feasible | One extra handshake per call; a pool is a later optimisation |
| **SQLite on a PVC** for gateway state | No extra database to run for a small team tool | One writer: 1 replica and `Recreate`. Scaling out needs Postgres |
| **Dashboard and gateway on one host** | One origin: no CORS code, CSP can say "connect to self only" | Ingress path routing; two Ingresses share one TLS Secret |
| **Secrets created outside the charts** (`create-secrets.sh`) | No secret in git, values or Helm release history; Helm cannot adopt existing Secrets | Must run before install |
| **Chat agent inside the gateway, OpenAI-compatible `fetch`** | Acts as the user with no extra hop; provider is swappable by values | Free-tier quota limits demos |
| **Default-deny NetworkPolicies** installed as their own chart | Makes "internal only" real; can be rolled back independently | Needs a policy-enforcing CNI (k3s has one) |

## 2. How tool aggregation, routing and failure handling work

**Aggregation.** `tools/list` asks every *enabled* upstream in parallel (3 s deadline each, `Promise.allSettled`), prefixes each tool `<slug>__<name>`, tags the description `[slug]`, drops invalid names, and returns the union. A dead server only removes its own tools.

**Routing.** `tools/call` splits the name on the **first** `__` (slugs cannot contain `_`, enforced by a DB `CHECK`), finds the slug among **enabled** servers, and forwards the original tool name. Disabled or unknown servers do not resolve, so a hidden tool is also rejected if called directly.

**Collisions.** Two servers can both expose `list_orders`; they appear as `woo__list_orders` and `shop__list_orders`. The prefix is always applied, so names are stable when servers are added later.

**Failure handling.**

| Situation | Behaviour |
|---|---|
| Upstream slow or dead during list | That server's tools are omitted, status `Unreachable` + reason; others unaffected; total time = slowest deadline |
| Upstream slow or dead during call | After 15 s (or immediately on refusal) the caller gets `isError: true` with e.g. `timed out after 15000ms`, `connection refused`, `upstream rejected the credential (401)` |
| Upstream protocol error (bad tool/args) | Reported to the caller; server stays `Connected` |
| Unknown/disabled tool | JSON-RPC `-32602` (the request is wrong) |
| Audit write fails | Call still succeeds (fail-open, chosen deliberately; a regulated system would fail closed) |

**Auditing.** One row per `tools/call`: user, server, tool, timestamp, duration, outcome (+ short error). Arguments are not stored.

## 3. Decisions with the trade-off spelled out

| Decision | Alternative | Why this way |
|---|---|---|
| Hash API keys with SHA-256 | bcrypt/argon2 | Keys are 256-bit random; slow hashes protect guessable passwords |
| Encrypt upstream credentials (AES-256-GCM) | Hash | The gateway must send the credential, so it must be recoverable |
| Prefix **always** | Prefix only on collision | Stable names |
| No `tools/list` cache | Short TTL cache | Correctness first: a disabled or dead server disappears immediately. Cost: N handshakes per list |
| Status updated on use, not by a background checker | Health-check loop | Fewer moving parts; the dashboard polls every 10 s so it looks live |
| Liveness probes never touch dependencies | Deep health checks | A database or upstream outage must not restart healthy pods |
| Seeding on first start only | Reconcile every start | A server an admin deletes stays deleted |
| Seed has no credentials | Credential in values | A credential in a Helm value is a plaintext secret |
| Audit omits tool arguments | Log them | Arguments can hold customer data and secrets |

## 4. What changes for production

| Area | Local | Production |
|---|---|---|
| DNS | `*.localhost` | A records for `store.<domain>` and `app.<domain>` |
| Ingress / TLS | Traefik, HTTP | Traefik + cert-manager (`ClusterIssuer letsencrypt`), HTTPS |
| Storage class | `local-path`, 1-2Gi | bigger sizes; a real storage class if available; backups |
| Secrets | `create-secrets.sh` | same now; external secret manager / sealed secrets and etcd encryption later |
| Images | `k3d image import` | registry (`image.repository`) |
| Scaling | 1 replica everywhere | gateway needs Postgres before more than 1 replica |

Details and the exact commands: [architecture/phase-7-local-to-prod.md](architecture/phase-7-local-to-prod.md). The VPS deployment itself has **not** been run.

## 5. Known limitations

- Gateway: one replica, brief downtime on upgrade (`Recreate`).
- All members share each upstream's credential and can call any tool (no per-tool permissions yet).
- No rate limiting, no metrics, no audit of admin actions, no audit retention.
- `notes` server is in-memory; `fx` uses fixed demo rates.
- WooCommerce REST key is created by hand.
- MariaDB/WordPress containers run with image defaults; the WooCommerce MCP container is non-root but not read-only.
- After an upstream pod restarts, the first `tools/list` may briefly time out (cause not found).
- Order emails are not sent (no SMTP).
