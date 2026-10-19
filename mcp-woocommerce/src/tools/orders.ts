// src/tools/orders.ts
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { wooRequest } from "../wooClient.js";
import { textResult, errorResult, failure } from "./result.js";

// WooCommerce order statuses. An enum means the model cannot send an invalid status.
const ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

// Statuses the model may SET. "refunded" is excluded on purpose: setting that status
// does not move any money and creates no refund record, it would only mislead.
const WRITABLE_STATUSES = ["processing", "on-hold", "completed", "cancelled"] as const;

// Only the fields we use.
interface WooOrder {
  id: number;
  status: string;
  currency: string;
  total: string;
  date_created: string;
  payment_method_title: string;
  billing: { first_name: string; last_name: string; city: string; country: string };
  line_items: { product_id: number; name: string; quantity: number; total: string }[];
}

// Data minimization: name and item count only. No email, phone or street address.
function summarize(o: WooOrder) {
  return {
    id: o.id,
    status: o.status,
    total: o.total,
    currency: o.currency,
    date_created: o.date_created,
    customer: `${o.billing.first_name} ${o.billing.last_name}`.trim(),
    item_count: o.line_items.reduce((n, item) => n + item.quantity, 0),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;

export function registerOrderTools(server: McpServer): void {
  server.registerTool(
    "list_orders",
    {
      description:
        "List orders in the WooCommerce store, newest first. Returns id, status, total, currency, date, customer name and item count. Optionally filter by status and by creation date (use `after` to get orders placed today or since a date). The result holds at most per_page orders: it does not say how many orders exist in total.",
      inputSchema: z.object({
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(10)
          .describe("How many orders to return (1-100, default 10)."),
        page: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .default(1)
          .describe("Page number, starting at 1."),
        status: z
          .enum(ORDER_STATUSES)
          .optional()
          .describe("Optional order status filter."),
        after: z
          .string()
          .regex(DATE_RE, "Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS")
          .optional()
          .describe("Only orders created after this date, in the store's time zone. Example: 2026-10-18 for orders placed today."),
        before: z
          .string()
          .regex(DATE_RE, "Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS")
          .optional()
          .describe("Only orders created before this date, in the store's time zone."),
      }),
    },
    async ({ per_page, page, status, after, before }) => {
      try {
        const query: Record<string, string> = {
          per_page: String(per_page),
          page: String(page),
        };
        if (status) query.status = status;
        // A bare date means the start of that day.
        if (after) query.after = after.includes("T") ? after : `${after}T00:00:00`;
        if (before) query.before = before.includes("T") ? before : `${before}T00:00:00`;

        const orders = await wooRequest<WooOrder[]>("GET", "/orders", query);
        return textResult(orders.map(summarize));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_order",
    {
      description:
        "Get one WooCommerce order by its id. Returns status, total, customer name, billing city and country, payment method and the ordered items.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The order id."),
      }),
    },
    async ({ id }) => {
      try {
        const o = await wooRequest<WooOrder>("GET", `/orders/${id}`);
        return textResult({
          ...summarize(o),
          payment_method: o.payment_method_title,
          billing_location: { city: o.billing.city, country: o.billing.country },
          items: o.line_items.map((item) => ({
            product_id: item.product_id,
            name: item.name,
            quantity: item.quantity,
            total: item.total,
          })),
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "update_order_status",
    {
      description:
        "Change the status of one WooCommerce order. This WRITES to the store: cancelling an order restocks its items, and status changes can trigger customer emails. Allowed new statuses: processing, on-hold, completed, cancelled. Calling it again with the same status changes nothing.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The order id."),
        status: z.enum(WRITABLE_STATUSES).describe("The new order status."),
      }),
    },
    async ({ id, status }) => {
      try {
        // Read first: lets us report previous_status and skip a pointless write (idempotent).
        const current = await wooRequest<WooOrder>("GET", `/orders/${id}`);

        if (current.status === status) {
          return textResult({
            id,
            previous_status: current.status,
            new_status: status,
            changed: false,
          });
        }

        // A refunded order has had its money returned. Reopening it by status would be misleading.
        if (current.status === "refunded") {
          return failure(
            `Order ${id} is refunded and its status cannot be changed with this tool.`
          );
        }

        const updated = await wooRequest<WooOrder>("PUT", `/orders/${id}`, {}, { status });
        return textResult({
          id,
          previous_status: current.status,
          new_status: updated.status,
          changed: true,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}