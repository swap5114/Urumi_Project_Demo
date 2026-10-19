#!/usr/bin/env bash
# Stores the LLM API key in the gateway Secret as "llm-api-key" (it is never put in a values file or in git).
# The key is read from the environment so it does not end up in your shell history or in a process list.
# Usage:  GEMINI_API_KEY=... scripts/set-llm-key.sh [namespace]     (or LLM_API_KEY=...)
set -euo pipefail

NS="${1:-urumi}"
KEY="${LLM_API_KEY:-${GEMINI_API_KEY:-}}"
[ -n "$KEY" ] || { echo "set GEMINI_API_KEY (or LLM_API_KEY) in your environment first" >&2; exit 1; }

kubectl get secret gateway-secrets -n "$NS" >/dev/null 2>&1 \
  || { echo "Secret gateway-secrets not found in namespace $NS: run scripts/create-secrets.sh first" >&2; exit 1; }

# The patch goes in through stdin, not on the command line. The key is base64-encoded first so that
# quotes or backslashes in it cannot break the JSON.
ENCODED="$(printf %s "$KEY" | base64 -w0)"
printf '{"data":{"llm-api-key":"%s"}}' "$ENCODED" | kubectl patch secret gateway-secrets -n "$NS" --type merge --patch-file /dev/stdin >/dev/null
echo "llm-api-key stored in gateway-secrets ($NS). Restart the gateway to pick it up:"
echo "  kubectl rollout restart deploy/gateway -n $NS"
