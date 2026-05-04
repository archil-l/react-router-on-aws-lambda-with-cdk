import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { createSignedFetcher } from "aws-sigv4-fetch";
import { verifyAuthHeader } from "../auth/jwt-verifier.js";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const JWT_SECRET_ARN = process.env.JWT_SECRET_ARN;
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const CLIENT_ACCESS_ROLE_ARN = process.env.CLIENT_ACCESS_ROLE_ARN;

const secretsClient = new SecretsManagerClient({ region: AWS_REGION });

async function fetchJWTSecret(): Promise<string> {
  if (!JWT_SECRET_ARN) {
    throw new Error("JWT_SECRET_ARN environment variable is not set");
  }
  const command = new GetSecretValueCommand({ SecretId: JWT_SECRET_ARN });
  const response = await secretsClient.send(command);
  if (response.SecretString) {
    const secretJson = JSON.parse(response.SecretString);
    return secretJson.secret;
  }
  throw new Error("Secret does not have a SecretString");
}

async function getCredentials() {
  const stsClient = new STSClient({ region: AWS_REGION });
  const response = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: CLIENT_ACCESS_ROLE_ARN,
      RoleSessionName: "mcp-proxy-session",
      DurationSeconds: 900,
    }),
  );
  if (!response.Credentials) {
    throw new Error("Failed to get temporary credentials from STS");
  }
  return {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken,
  };
}

// CORS is handled entirely by the Lambda Function URL configuration.
// Do NOT set Access-Control-* headers here — that causes duplicates.

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // OPTIONS preflight is handled by the Lambda Function URL CORS config
  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 204, headers: {}, body: "" };
  }

  if (event.requestContext.http.method !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  if (!MCP_SERVER_URL) {
    return {
      statusCode: 503,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "MCP server not configured" }),
    };
  }

  // Verify JWT
  let jwtSecret: string;
  try {
    jwtSecret = await fetchJWTSecret();
  } catch (err) {
    console.error("[MCP Proxy] Failed to fetch JWT secret:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }

  const verificationResult = verifyAuthHeader(
    event.headers as Record<string, string>,
    jwtSecret,
  );

  if (!verificationResult) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing Authorization header" }),
    };
  }

  if (!verificationResult.valid) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: verificationResult.error || "Unauthorized" }),
    };
  }

  // Assume IAM role and sign request
  let signedFetch: typeof fetch;
  try {
    const credentials = await getCredentials();
    signedFetch = createSignedFetcher({
      service: "lambda",
      region: AWS_REGION,
      credentials,
    });
  } catch (err) {
    console.error("[MCP Proxy] Failed to assume IAM role:", err);
    return {
      statusCode: 503,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to authenticate with MCP server" }),
    };
  }

  // Forward request to MCP server
  let mcpResponse: Response;
  try {
    mcpResponse = await signedFetch(MCP_SERVER_URL, {
      method: "POST",
      headers: {
        "Content-Type":
          event.headers["content-type"] || "application/json",
        Accept: event.headers["accept"] || "application/json, text/event-stream",
      },
      body: event.body ?? "",
    });
  } catch (err) {
    console.error("[MCP Proxy] Failed to reach MCP server:", err);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to reach MCP server" }),
    };
  }

  const responseBody = await mcpResponse.text();
  const contentType =
    mcpResponse.headers.get("content-type") ?? "application/json";

  return {
    statusCode: mcpResponse.status,
    headers: { "Content-Type": contentType },
    body: responseBody,
  };
};
