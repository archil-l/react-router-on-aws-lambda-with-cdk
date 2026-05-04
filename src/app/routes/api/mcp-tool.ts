/**
 * MCP Tool Proxy Route
 *
 * Allows the browser-side MCP app (running in the sandbox iframe) to call
 * MCP server tools without a direct server connection. The request is
 * authenticated with the same JWT used by the streaming Lambda, then
 * forwarded to the MCP server via the server-side MCP client.
 *
 * POST /api/mcp-tool
 * Authorization: Bearer <jwt>
 * Body: { name: string, arguments: Record<string, unknown> }
 * Response: CallToolResult JSON
 */

import type { ActionFunctionArgs } from "react-router";
import { verifyAuthHeader } from "../../server/auth/jwt-verifier.js";
import { getMcpTools } from "../../server/mcp/mcp-client.js";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
});

async function fetchJWTSecret(): Promise<string> {
  const secretArn = process.env.JWT_SECRET_ARN;
  if (!secretArn) {
    throw new Error("JWT_SECRET_ARN environment variable is not set");
  }
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await secretsClient.send(command);
  if (response.SecretString) {
    const secretJson = JSON.parse(response.SecretString);
    return secretJson.secret;
  }
  throw new Error("Secret does not have a SecretString");
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Verify JWT
    const jwtSecret = await fetchJWTSecret();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const verificationResult = verifyAuthHeader(headers, jwtSecret);

    if (!verificationResult) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!verificationResult.valid) {
      return new Response(
        JSON.stringify({ error: verificationResult.error || "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // Parse body
    const body = await request.json();
    const { name, arguments: toolArguments } = body as {
      name?: string;
      arguments?: Record<string, unknown>;
    };

    if (!name || typeof name !== "string") {
      return new Response(JSON.stringify({ error: "name is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Call the MCP tool
    const { callTool, close } = await getMcpTools();
    try {
      const result = await callTool(name, toolArguments ?? {});
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      await close();
    }
  } catch (error) {
    console.error("[MCP Tool Proxy] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
