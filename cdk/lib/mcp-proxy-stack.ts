import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { EnvironmentConfig } from "../config/environments.js";
import { SecretsStack } from "./secrets-stack.js";
import { DnsStack } from "./dns-stack.js";

interface McpProxyStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
  secretsStack: SecretsStack;
  dnsStack?: DnsStack;
}

export class McpProxyStack extends cdk.Stack {
  public readonly functionUrl: lambda.FunctionUrl;
  /** The public-facing domain for the proxy (e.g. https://proxy.your-domain.com) */
  public readonly proxyEndpoint: string;

  constructor(scope: Construct, id: string, props: McpProxyStackProps) {
    super(scope, id, props);

    const { envConfig, secretsStack, dnsStack } = props;

    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    // Import MCP server details from the external MCP server stack (optional)
    const mcpServerFunctionArn = cdk.Fn.importValue(
      `mcp-server-function-arn-${envConfig.stage}`,
    );
    const mcpServerFunctionUrl = cdk.Fn.importValue(
      `mcp-server-function-url-${envConfig.stage}`,
    );
    const clientAccessRoleArn = cdk.Fn.importValue(
      `mcp-server-client-access-role-arn-${envConfig.stage}`,
    );

    const logGroup = new logs.LogGroup(this, "mcp-proxy-log-group", {
      logGroupName: `/aws/lambda/${id}-mcp-proxy-function`,
      retention: envConfig.logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function for MCP proxy
    const mcpProxyFunction = new lambda.Function(
      this,
      "mcp-proxy-function",
      {
        functionName: `${id}-mcp-proxy-function`,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../../dist/mcp-proxy-lambda"),
        ),
        handler: "mcp-proxy-handler.handler",
        runtime: Runtime.NODEJS_24_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(30),
        architecture: Architecture.X86_64,
        environment: {
          NODE_ENV: "production",
          JWT_SECRET_ARN: secretsStack.jwtSecretArn,
          MCP_SERVER_URL: cdk.Fn.join("", [mcpServerFunctionUrl, "mcp"]),
          CLIENT_ACCESS_ROLE_ARN: clientAccessRoleArn,
        },
        logGroup,
      },
    );

    // Grant permission to invoke MCP server Lambda Function URL
    mcpProxyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunctionUrl"],
        resources: [mcpServerFunctionArn],
      }),
    );

    // Grant permission to assume the MCP server client access role
    mcpProxyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [clientAccessRoleArn],
      }),
    );

    // Grant Lambda function read access to JWT secret
    secretsStack.jwtSecret.grantRead(mcpProxyFunction);

    // Add Function URL (buffered — MCP responses are JSON, not streams).
    // No CORS config here — CloudFront handles CORS for the proxy domain.
    this.functionUrl = mcpProxyFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    // Extract the hostname from the Function URL (strip trailing slash)
    const functionUrlHostname = cdk.Fn.select(
      2,
      cdk.Fn.split("/", this.functionUrl.url),
    );

    // If a DNS stack is provided, put a CloudFront distribution in front
    // of the Lambda Function URL and serve it at proxy.<domainName>.
    if (dnsStack && envConfig.domainName) {
      const proxyDomain = `proxy.${envConfig.domainName}`;

      const distribution = new cloudfront.Distribution(
        this,
        "mcp-proxy-distribution",
        {
          defaultBehavior: {
            origin: new origins.HttpOrigin(functionUrlHostname, {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
              originPath: "/",
            }),
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy:
              cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(
              this,
              "mcp-proxy-cors-policy",
              {
                corsBehavior: {
                  accessControlAllowCredentials: true,
                  accessControlAllowHeaders: ["Content-Type", "Authorization"],
                  accessControlAllowMethods: ["POST", "OPTIONS"],
                  accessControlAllowOrigins: [
                    `https://${envConfig.domainName}`,
                    "http://localhost:5173",
                  ],
                  originOverride: true,
                },
              },
            ),
          },
          domainNames: [proxyDomain],
          certificate: dnsStack.certificate,
          comment: `MCP Proxy distribution for ${proxyDomain}`,
        },
      );

      // Route53 A record: proxy.<domainName> → CloudFront
      new route53.ARecord(this, "mcp-proxy-alias-record", {
        zone: dnsStack.hostedZone,
        recordName: proxyDomain,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
      });

      this.proxyEndpoint = `https://${proxyDomain}`;

      new cdk.CfnOutput(this, "mcp-proxy-domain", {
        description: "MCP Proxy custom domain",
        value: this.proxyEndpoint,
        exportName: `mcp-proxy-endpoint-${envConfig.stage}`,
      });
    } else {
      // Fallback to raw Function URL when no custom domain is configured
      this.proxyEndpoint = this.functionUrl.url;
    }

    // Outputs
    new cdk.CfnOutput(this, "mcp-proxy-function-url", {
      description: "Lambda Function URL for MCP proxy (internal — use proxyEndpoint for public access)",
      value: this.functionUrl.url,
      // No exportName — this URL is no longer referenced cross-stack
    });

    new cdk.CfnOutput(this, "mcp-proxy-function-arn", {
      description: "MCP Proxy Lambda Function ARN",
      value: mcpProxyFunction.functionArn,
    });
  }
}
