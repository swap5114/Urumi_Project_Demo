import { McpServer } from "@modelcontextprotocol/server";
import { registerProductTools } from "./tools/products.js";
import { registerOrderTools } from "./tools/orders.js";


export function createWooServer(): McpServer {
  const server = new McpServer({ name: "woocommerce-mcp", version: "1.0.0" });
  registerProductTools(server);
  registerOrderTools(server);
  return server;
}