// src/wooClient.ts

// THIS FILE SENTS A SIGNED REST REQUEST TO WOO COMMERCE SERVER WE BUILT A WRAPPER HERE SO WE DONT HAVE TO SIGN EVERY REQUEST WE SEND WHICH IS BAD PRODUCTION CODE PRACTISE AND CAUSE MORE ERROS
// HERE WE HAVE ONE SINGLE POINT Of ERROR
import crypto from "node:crypto";

export interface WooConfig {
  baseUrl: string; // jis address pe hum connect karte hain (cluster mein: http://wordpress)
  signBaseUrl: string; // NEW: jis URL se WooCommerce signature verify karta hai (uski site URL)
  key: string;
  secret: string;
}

export class WooApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "WooApiError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WooConfig {
  const { WC_BASE_URL, WC_SIGN_BASE_URL, WC_KEY, WC_SECRET } = env;
  const missing: string[] = [];
  if (!WC_BASE_URL) missing.push("WC_BASE_URL");
  if (!WC_KEY) missing.push("WC_KEY");
  if (!WC_SECRET) missing.push("WC_SECRET");
  if (missing.length > 0 || !WC_BASE_URL || !WC_KEY || !WC_SECRET) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
  const baseUrl = WC_BASE_URL.replace(/\/+$/, "");
  return {
    baseUrl,
    // NEW: optional. Na ho to baseUrl hi use hoga, taaki local dev bina badlav ke chale.
    signBaseUrl: (WC_SIGN_BASE_URL || baseUrl).replace(/\/+$/, ""),
    key: WC_KEY,
    secret: WC_SECRET,
  };
}


function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase()
  );
}


function toQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join("&");
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function wooRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  query: Record<string, string> = {},
  body?: unknown,
  cfg: WooConfig = loadConfig()
): Promise<T> {
  // NEW: do alag URL. Ek se connect karte hain, doosre se sign karte hain.
  const connectEndpoint = `${cfg.baseUrl}/wp-json/wc/v3${path}`;
  const signEndpoint = `${cfg.signBaseUrl}/wp-json/wc/v3${path}`;

  const allParams: Record<string, string> = {
    ...query,
    oauth_consumer_key: cfg.key,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };


  // NEW: signature signEndpoint (site URL) se banta hai, kyunki WooCommerce verify karte waqt wahi use karta hai
  const baseString = [method, encode(signEndpoint), encode(toQuery(allParams))].join("&");


  const signature = crypto
    .createHmac("sha256", `${encode(cfg.secret)}&`)
    .update(baseString)
    .digest("base64");

  // NEW: request asal mein connectEndpoint pe jaati hai
  const url = `${connectEndpoint}?${toQuery({ ...allParams, oauth_signature: signature })}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
    const reason = cause?.code ?? cause?.errors?.[0]?.code ?? (err as Error).name;

    throw new WooApiError(0, "woo_unreachable", `Could not reach WooCommerce (${reason})`);
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const err = (data ?? {}) as { code?: string; message?: string };
    throw new WooApiError(
      response.status,
      err.code ?? "woo_error",
      err.message ?? `WooCommerce returned HTTP ${response.status}`
    );
  }

  if (data === undefined) {
    throw new WooApiError(response.status, "woo_invalid_response", "WooCommerce returned a non-JSON response");
  }
  return data as T;
}