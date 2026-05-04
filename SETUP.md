# Setup Guide

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 24 | Required — matches Lambda runtime |
| AWS CLI | v2 | `aws --version` |
| AWS CDK | 2.x | Installed as a dev dependency (`npx cdk`) |
| AWS account | — | With permissions to create Lambda, CloudFront, S3, Secrets Manager, Route 53, IAM |
| Anthropic API key | — | Get one at console.anthropic.com |

**Recommended: configure a named AWS CLI profile** for this project (e.g. `aws configure --profile myapp`) rather than using the default profile, so deploys don't accidentally hit the wrong account.

---

## Quickstart: run the setup script

```bash
git clone <your-repo>
cd <your-repo>
bash setup.sh
```

The script will ask for:

- **App name** — used as a prefix for all CDK stack names (e.g. `my-app` → `my-app-secrets-prod`, `my-app-prod`, etc.)
- **AWS account ID** (12 digits)
- **AWS region** (default: `us-east-1`)
- **GitHub org and repo** — for OIDC-based CI/CD (no stored AWS credentials in GitHub)
- **Custom domain** (optional)
- **Anthropic API key** — written to `.env.local`, never committed

After the script finishes, jump to [Build & Deploy](#build--deploy).

---

## Manual setup (alternative)

If you prefer not to use the script:

### 1. Configure your environment

Edit [cdk/config/environments.ts](cdk/config/environments.ts):

```typescript
[Stage.prod]: {
  accountId: "123456789012",   // your 12-digit AWS account ID
  region: "us-east-1",
  // domainName: "myapp.example.com",  // uncomment for a custom domain
  ...
}
```

### 2. Set app name and GitHub details

Edit [cdk/app.ts](cdk/app.ts):

```typescript
const GITHUB_ORG  = "your-github-org";
const GITHUB_REPO = "your-repo-name";
const APP_NAME    = "my-app";
```

### 3. Create `.env.local`

```bash
cp .env.example .env.local   # if it exists, otherwise create manually
```

`.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-...
# TURNSTILE_SITE_KEY=...     # optional
# TURNSTILE_SECRET_KEY=...   # optional
```

`.env.local` is git-ignored. The CDK reads these at `cdk deploy` time and bakes them into Lambda environment variables.

---

## Customize the AI assistant

Two files control the AI behavior:

| File | Purpose |
|------|---------|
| [src/app/lib/agent/system-prompt.ts](src/app/lib/agent/system-prompt.ts) | Claude's system prompt — define its persona, tone, and capabilities |
| [src/app/features/welcome/constants.ts](src/app/features/welcome/constants.ts) | Welcome message and suggestion buttons shown to users |

---

## Build & Deploy

### Install dependencies

```bash
npm install
```

### Bootstrap CDK (first time only)

CDK needs to provision an S3 bucket and ECR repo in your account before it can deploy:

```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/YOUR_REGION
```

### Build everything

```bash
npm run release
```

This runs in order:
1. `rm -rf dist` — clean previous build
2. `npx @react-router/dev build` — build React Router app (SSR + client)
3. `node esbuild.config.js` — bundle all 3 Lambda packages
4. `tsc -p cdk/tsconfig.json` — compile CDK TypeScript
5. `npx cdk synth` — synthesize CloudFormation templates

### Deploy all stacks

```bash
# Load .env.local so ANTHROPIC_API_KEY is available to CDK
source .env.local && npx cdk deploy --all
```

Or with a named AWS profile:

```bash
source .env.local && npx cdk deploy --all --profile myapp
```

CDK deploys 6 stacks in dependency order:

| Stack | What it creates |
|-------|----------------|
| `<app>-secrets-prod` | JWT signing secret in Secrets Manager |
| `<app>-github-oidc-prod` | OIDC trust for GitHub Actions |
| `<app>-dns-prod` | Route 53 hosted zone + ACM certificate *(only if `domainName` is set)* |
| `<app>-llm-stream-prod` | Streaming Lambda + Function URL |
| `<app>-mcp-proxy-prod` | MCP Proxy Lambda + Function URL |
| `<app>-prod` | Web Lambda, API Gateway, CloudFront, S3 |

The final output includes your **CloudFront URL** (and custom domain URL if configured).

### Custom domain: extra DNS step

If you set a `domainName`, the `DnsStack` creates a Route 53 hosted zone. After that stack deploys, copy the **nameserver records** from the CDK output and set them at your domain registrar. ACM certificate validation is automatic once DNS propagates (usually a few minutes).

---

## CI/CD with GitHub Actions

The `GitHubOIDCStack` creates an IAM role that your GitHub Actions workflows can assume via OIDC — no AWS credentials stored in GitHub secrets.

Add this to your workflow:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::YOUR_ACCOUNT_ID:role/<app>-github-oidc-prod-github-actions-role
      aws-region: us-east-1
```

The role has `PowerUserAccess`. Scope it down in [cdk/lib/github-oidc-stack.ts](cdk/lib/github-oidc-stack.ts) if needed.

---

## Partial deploys

After initial setup you usually only need to redeploy changed stacks:

```bash
# Redeploy only the web app (most common)
source .env.local && npx cdk deploy <app>-prod

# Redeploy only the streaming Lambda
npm run cdk:deploy:streaming

# Redeploy only the MCP proxy
npm run cdk:deploy:mcp-proxy
```

---

## Key environment variables

These are set via CDK at deploy time (not manually in the Lambda console):

| Variable | Set by | Purpose |
|----------|--------|---------|
| `ANTHROPIC_API_KEY` | `.env.local` at deploy time | Claude API access |
| `JWT_SECRET_ARN` | CDK (SecretsStack output) | JWT signing key location |
| `LLM_STREAM_URL` | CDK (LLMStreamStack output) | Streaming Lambda URL |
| `MCP_PROXY_ENDPOINT` | CDK (McpProxyStack output) | MCP proxy URL for client |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | `.env.local` at deploy time | Bot protection (optional) |

---

## Lambda Web Adapter

The web Lambda uses the [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) layer to run Express as a standard HTTP server inside Lambda. The layer ARN is pinned in [cdk/lib/web-app-stack.ts](cdk/lib/web-app-stack.ts):

```
arn:aws:lambda:<region>:753240598075:layer:LambdaAdapterLayerX86:25
```

Check the [Lambda Web Adapter releases](https://github.com/awslabs/aws-lambda-web-adapter/releases) for newer versions.

---

## Local development

```bash
npm run dev
```

Opens at `http://localhost:5173`. The dev server runs React Router in SSR mode via Vite. The streaming Lambda and MCP proxy are not running locally — AI chat calls will fail unless you wire up a local equivalent or point at deployed Function URLs.

---

## Troubleshooting

**`cdk deploy` fails with "account ID not configured"**
→ Run `npm run release` first (CDK synth needs the compiled output), then deploy.

**CloudFront returns 502 or 504**
→ Check the web Lambda logs in CloudWatch: `/aws/lambda/<app>-prod-web-app-function`.

**Streaming Lambda times out**
→ Default timeout is 5 minutes. Claude responses on cold start can be slow — check Lambda memory (1 024 MB is the default; increase in `environments.ts` if needed).

**ACM certificate stuck in "Pending validation"**
→ DNS hasn't propagated yet, or nameservers aren't set at the registrar. Verify with `dig NS yourdomain.com`.
