// src/tools/products.ts
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { wooRequest } from "../wooClient.js";
import { textResult, errorResult } from "./result.js";

// Only the fields we use. WooCommerce returns 100+ fields per product.
interface WooProduct {
  id: number;
  name: string;
  sku: string;
  price: string;
  stock_status: string;
  status: string;
}

// Same trimmed shape for every tool that returns a product.
function summarizeProduct(p: WooProduct) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    stock_status: p.stock_status,
    status: p.status,
  };
}

export function registerProductTools(server: McpServer): void {
  server.registerTool(
    "list_products",
    {
      description:
        "List products in the WooCommerce store. Returns id, name, sku, price, stock status and publish status. Supports paging and a text search.",
      inputSchema: z.object({
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(10)
          .describe("How many products to return (1-100, default 10)."),
        page: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .default(1)
          .describe("Page number, starting at 1."),
        search: z
          .string()
          .optional()
          .describe("Optional text to search in product names."),
      }),
    },
    async ({ per_page, page, search }) => {
      try {
        const query: Record<string, string> = {
          per_page: String(per_page),
          page: String(page),
        };
        if (search) query.search = search;

        const products = await wooRequest<WooProduct[]>("GET", "/products", query);
        return textResult(products.map(summarizeProduct));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "create_product",
    {
      description:
        "Create a new simple product in the WooCommerce store. This WRITES to the store. The product is published (live in the shop) unless status is set to draft. If a sku is given and already exists, the call fails.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200).describe("Product name."),
        regular_price: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, "Use a plain decimal number such as 499 or 499.00")
          .describe("Regular price as a decimal string, for example 499.00."),
        sku: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("Optional unique SKU. Creation fails if this SKU already exists."),
        status: z
          .enum(["draft", "publish"])
          .default("publish")
          .describe("publish (default, live in the shop) or draft (saved but not visible)."),
      }),
    },
    async ({ name, regular_price, sku, status }) => {
      try {
        const body: Record<string, string> = {
          name,
          type: "simple",
          regular_price,
          status,
        };
        if (sku) body.sku = sku;

        const created = await wooRequest<WooProduct>("POST", "/products", {}, body);
        return textResult(summarizeProduct(created));
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}