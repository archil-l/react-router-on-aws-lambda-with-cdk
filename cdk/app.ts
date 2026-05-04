#!/usr/bin/env node
import "source-map-support/register.js";
import * as cdk from "aws-cdk-lib";
import { WebAppStack } from "./lib/web-app-stack.js";
import { GitHubOidcStack } from "./lib/github-oidc-stack.js";
import { DnsStack } from "./lib/dns-stack.js";
import { LLMStreamStack } from "./lib/llm-stream-stack.js";
import { McpProxyStack } from "./lib/mcp-proxy-stack.js";
import { SecretsStack } from "./lib/secrets-stack.js";
import { getEnvironmentConfig, Stage } from "./config/environments.js";

// TODO: Set your GitHub org and repo name for OIDC-based deployments
const GITHUB_ORG = "YOUR_GITHUB_ORG";
const GITHUB_REPO = "YOUR_GITHUB_REPO";

// TODO: Set your app name — used as a prefix for all stack names
const APP_NAME = "my-app";

const app = new cdk.App();

const envConfig = getEnvironmentConfig(Stage.prod);

console.log(
  `Deploying to ${envConfig.stage} environment (Account: ${envConfig.accountId}, Region: ${envConfig.region})`,
);

const env = {
  account: envConfig.accountId,
  region: envConfig.region,
};

// Secrets Stack - manages JWT signing secret
const secretsStack = new SecretsStack(
  app,
  `${APP_NAME}-secrets-${envConfig.stage}`,
  { envConfig, env },
);

// OIDC Stack - for GitHub Actions authentication
new GitHubOidcStack(app, `${APP_NAME}-github-oidc-${envConfig.stage}`, {
  envConfig,
  githubOrg: GITHUB_ORG,
  githubRepo: GITHUB_REPO,
  env,
});

// DNS Stack - hosted zone + ACM certificate for your domain.
// Deploy this once. Copy the nameserver output to your registrar.
// Remove or skip this stack if you don't need a custom domain.
let dnsStack: DnsStack | undefined;
if (envConfig.domainName) {
  dnsStack = new DnsStack(app, `${APP_NAME}-dns-${envConfig.stage}`, {
    domainName: envConfig.domainName,
    env,
  });
}

// LLM Streaming Stack - separate Lambda with Function URL for streaming responses
const llmStreamStack = new LLMStreamStack(
  app,
  `${APP_NAME}-llm-stream-${envConfig.stage}`,
  { envConfig, secretsStack, env },
);
llmStreamStack.addDependency(secretsStack);

// MCP Proxy Stack - dedicated Lambda for client-side MCP access
const mcpProxyStack = new McpProxyStack(
  app,
  `${APP_NAME}-mcp-proxy-${envConfig.stage}`,
  { envConfig, secretsStack, dnsStack, env },
);
mcpProxyStack.addDependency(secretsStack);
if (dnsStack) mcpProxyStack.addDependency(dnsStack);

// Application Stack - the actual web app
const webAppStack = new WebAppStack(app, `${APP_NAME}-${envConfig.stage}`, {
  envConfig,
  dnsStack,
  secretsStack,
  llmStreamStack,
  mcpProxyStack,
  env,
});
webAppStack.addDependency(secretsStack);
webAppStack.addDependency(llmStreamStack);
webAppStack.addDependency(mcpProxyStack);
if (dnsStack) webAppStack.addDependency(dnsStack);
