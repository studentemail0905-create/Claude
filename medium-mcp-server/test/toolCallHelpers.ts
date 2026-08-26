import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** Calls a tool and parses its single JSON text-content block. Throws with the tool's error text if isError. */
export async function callToolJson(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  const block = (result.content as Array<{ type: string; text?: string }>)[0];
  const text = block?.type === "text" ? block.text : undefined;
  if (result.isError) {
    throw new Error(text ?? "tool call failed");
  }
  return text ? JSON.parse(text) : undefined;
}

/** Calls a tool expecting it to fail, returning the error text. */
export async function callToolExpectError(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  if (!result.isError) {
    throw new Error(`Expected tool "${name}" to return isError=true, but it succeeded.`);
  }
  const block = (result.content as Array<{ type: string; text?: string }>)[0];
  return block?.type === "text" ? (block.text ?? "") : "";
}
