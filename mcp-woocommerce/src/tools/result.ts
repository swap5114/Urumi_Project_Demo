
import { WooApiError } from "../wooClient.js";

export function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}


export function failure(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

// Tool errors are returned (isError: true), not thrown, so the model can read them and react.
export function errorResult(err: unknown) {
  if (err instanceof WooApiError) {
    return failure(`WooCommerce error (${err.status} ${err.code}): ${err.message}`);
  }
  console.error("Unexpected tool error:", (err as Error).message);
  return failure("Unexpected error while calling WooCommerce.");
}