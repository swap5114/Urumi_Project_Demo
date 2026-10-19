import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { failure, textResult } from "./result.js";

// A FIXED table of demo rates (units of currency per 1 USD). They are NOT live market rates: the server needs no
// internet access, and the same question always gives the same answer, which keeps a demo and a test repeatable.
const RATES_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.2,
  JPY: 149.5,
  AUD: 1.52,
  CAD: 1.36,
};
const SUPPORTED = Object.keys(RATES_PER_USD);
const NOTE = "Fixed demo rates, not live market rates.";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function createFxServer(): McpServer {
  const server = new McpServer({ name: "fx-mcp", version: "1.0.0" });

  server.registerTool(
    "list_currencies",
    {
      description: `List the supported currency codes and their rate per 1 USD. ${NOTE}`,
      inputSchema: z.object({}),
    },
    async () => textResult({ base: "USD", rates: RATES_PER_USD, note: NOTE }),
  );

  server.registerTool(
    "convert_currency",
    {
      description: `Convert an amount from one currency to another. Supported: ${SUPPORTED.join(", ")}. ${NOTE}`,
      inputSchema: z.object({
        amount: z.number().min(0).max(1_000_000_000_000).describe("The amount to convert."),
        from: z.string().trim().length(3).describe("Source currency code, for example USD."),
        to: z.string().trim().length(3).describe("Target currency code, for example INR."),
      }),
    },
    async ({ amount, from, to }) => {
      const f = from.toUpperCase();
      const t = to.toUpperCase();
      const rf = RATES_PER_USD[f];
      const rt = RATES_PER_USD[t];
      if (!rf || !rt) {
        return failure(`Unsupported currency: ${!rf ? f : t}. Supported: ${SUPPORTED.join(", ")}.`);
      }
      const rate = rt / rf;
      return textResult({ amount, from: f, to: t, rate: Math.round(rate * 1e6) / 1e6, result: round2(amount * rate), note: NOTE });
    },
  );

  return server;
}
