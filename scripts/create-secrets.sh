#!/usr/bin/env bash
# Creates the Kubernetes Secrets the charts expect. Safe to re-run: a Secret that already exists is left alone.
# Passwords are random and are never written to a file or to git.
# Usage: scripts/create-secrets.sh [namespace]      (default namespace: urumi)
set -euo pipefail

NS="${1:-urumi}"
WP_ADMIN_EMAIL="${WP_ADMIN_EMAIL:-admin@store.localhost}"

kubectl get namespace "$NS" >/dev/null 2>&1 || kubectl create namespace "$NS"

rand() { openssl rand -hex 16; }   # 32 hex characters

create_if_missing() {
  local name="$1"; shift
  if kubectl get secret "$name" -n "$NS" >/dev/null 2>&1; then
    echo "exists, left unchanged: $name"
  else
    kubectl create secret generic "$name" -n "$NS" "$@" >/dev/null
    echo "created: $name"
  fi
}

create_if_missing mariadb-credentials \
  --from-literal=root-password="$(rand)" --from-literal=password="$(rand)"

create_if_missing wordpress-admin \
  --from-literal=username=urumi-admin --from-literal=password="$(rand)" --from-literal=email="$WP_ADMIN_EMAIL"

# The gateway: enc-key encrypts upstream credentials, bootstrap-admin-key is the first admin's API key.
create_if_missing gateway-secrets \
  --from-literal=enc-key="$(openssl rand -base64 32)" --from-literal=bootstrap-admin-key="$(rand)$(rand)"

echo
echo "WordPress admin password:"
echo "  kubectl get secret wordpress-admin -n $NS -o jsonpath='{.data.password}' | base64 -d; echo"
echo "Gateway admin API key (the first admin logs in with this):"
echo "  kubectl get secret gateway-secrets -n $NS -o jsonpath='{.data.bootstrap-admin-key}' | base64 -d; echo"
echo "The WooCommerce REST key (woocommerce-api-keys) is created after the store is up, see README."
