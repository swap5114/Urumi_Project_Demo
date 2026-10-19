#!/usr/bin/env bash
# Checks the network rules of the namespace: who CAN reach whom, and who must NOT.
# It opens TCP connections from inside the real pods (and from a temporary pod that has no app label, a stand-in
# for "some other pod in the cluster"), and reports PASS or FAIL for each expectation.
# Usage: scripts/netpol-check.sh [namespace]      (default: urumi)
# On a server with real domains: STORE_HOST=store.example.com APP_HOST=app.example.com scripts/netpol-check.sh urumi
set -uo pipefail
NS="${1:-urumi}"
STORE_HOST="${STORE_HOST:-store.localhost}"   # the Host header sent to the Ingress on this machine
APP_HOST="${APP_HOST:-app.localhost}"
pass=0; fail=0
INTRUDER=np-intruder

cleanup() { kubectl delete pod "$INTRUDER" -n "$NS" --ignore-not-found --wait=false >/dev/null 2>&1; }
trap cleanup EXIT

# A TCP connect from node-based pods: prints "open" if connected, "closed" on timeout or refusal.
NODE_TCP='const n=require("net");const s=n.connect({host:process.argv[1],port:+process.argv[2],timeout:3000},()=>{console.log("open");process.exit(0)});s.on("timeout",()=>{console.log("closed");process.exit(1)});s.on("error",()=>{console.log("closed");process.exit(1)})'

reach() {  # reach <from> <host> <port>   -> prints open|closed
  local from="$1" host="$2" port="$3"
  case "$from" in
    intruder)  kubectl exec -n "$NS" "$INTRUDER" -- nc -z -w 3 "$host" "$port" >/dev/null 2>&1 && echo open || echo closed ;;  # plain TCP connect: works for any protocol
    dashboard) kubectl exec -n "$NS" deploy/dashboard -- nc -z -w 3 "$host" "$port" >/dev/null 2>&1 && echo open || echo closed ;;
    wordpress) kubectl exec -n "$NS" deploy/wordpress -- bash -c "timeout 3 bash -c '</dev/tcp/$host/$port'" >/dev/null 2>&1 && echo open || echo closed ;;
    *)         kubectl exec -n "$NS" "deploy/$from" -- node -e "$NODE_TCP" "$host" "$port" 2>/dev/null | tail -1 ;;
  esac
}

expect() {  # expect <open|closed> <from> <host> <port> <description>
  local want="$1" from="$2" host="$3" port="$4" desc="$5" got
  got="$(reach "$from" "$host" "$port")"; [ -n "$got" ] || got=closed
  if [ "$got" = "$want" ]; then pass=$((pass+1)); printf "  PASS  %-6s %s\n" "$want" "$desc"
  else fail=$((fail+1)); printf "  FAIL  wanted %-6s got %-6s %s\n" "$want" "$got" "$desc"; fi
}

http_code() { curl -s -o /dev/null -m 5 -w '%{http_code}' -H "Host: $1" "http://localhost$2"; }
expect_http() {  # expect_http <code> <host> <path> <description>
  local got; got="$(http_code "$2" "$3")"
  if [ "$got" = "$1" ]; then pass=$((pass+1)); printf "  PASS  http %s  %s\n" "$1" "$4"
  else fail=$((fail+1)); printf "  FAIL  http wanted %s got %s  %s\n" "$1" "$got" "$4"; fi
}

kubectl run "$INTRUDER" -n "$NS" --image=curlimages/curl:8.10.1 --restart=Never --command -- sleep 600 >/dev/null 2>&1
kubectl wait --for=condition=Ready "pod/$INTRUDER" -n "$NS" --timeout=60s >/dev/null 2>&1 || echo "(the temporary pod did not start: its checks will fail)"

echo "Traffic that MUST work (through the Ingress, as a user would):"
expect_http 200 "$STORE_HOST" /                "storefront"
expect_http 200 "$APP_HOST"   /                "dashboard"
expect_http 401 "$APP_HOST"   /api/me          "gateway API (401 = reached, no key)"
expect_http 401 "$APP_HOST"   /mcp             "gateway MCP endpoint (401 = reached, no key)"

echo "Traffic that MUST work (between our own components):"
expect open gateway         woocommerce-mcp 80  "gateway  -> woocommerce-mcp"
expect open gateway         mcp-fx          80  "gateway  -> mcp-fx"
expect open gateway         mcp-notes       80  "gateway  -> mcp-notes"
expect open gateway         example.com    443  "gateway  -> the internet (LLM API, external MCP servers)"
expect open woocommerce-mcp wordpress       80  "woocommerce-mcp -> wordpress"
expect open wordpress       mariadb       3306  "wordpress -> mariadb"

echo "Traffic that must be BLOCKED (a random pod in the namespace):"
for t in "mcp-fx 80" "mcp-notes 80" "woocommerce-mcp 80" "gateway 80" "wordpress 80" "mariadb 3306"; do
  set -- $t; expect closed intruder "$1" "$2" "unlabeled pod -> $1"
done

echo "Traffic that must be BLOCKED (lateral movement between our own components):"
expect closed gateway         mariadb         3306 "gateway  -> mariadb (only wordpress may talk to the database)"
expect closed gateway         wordpress         80 "gateway  -> wordpress"
expect closed woocommerce-mcp mcp-fx            80 "woocommerce-mcp -> mcp-fx"
expect closed woocommerce-mcp mariadb         3306 "woocommerce-mcp -> mariadb"
expect closed mcp-fx          mcp-notes         80 "mcp-fx    -> mcp-notes"
expect closed mcp-fx          woocommerce-mcp   80 "mcp-fx    -> woocommerce-mcp"
expect closed dashboard       gateway           80 "dashboard -> gateway (the browser calls the gateway, not the pod)"
expect closed dashboard       mariadb         3306 "dashboard -> mariadb"

echo
echo "Result: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
