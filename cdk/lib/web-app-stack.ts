import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime, Architecture, LayerVersion } from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { EnvironmentConfig } from "../config/environments.js";
import { DnsStack } from "./dns-stack.js";
import { SecretsStack } from "./secrets-stack.js";
import { LLMStreamStack } from "./llm-stream-stack.js";
import { McpProxyStack } from "./mcp-proxy-stack.js";

interface WebAppStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
  dnsStack?: DnsStack;
  secretsStack: SecretsStack;
  llmStreamStack: LLMStreamStack;
  mcpProxyStack: McpProxyStack;
}

export class WebAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebAppStackProps) {
    super(scope, id, props);

    const { envConfig, secretsStack, llmStreamStack, mcpProxyStack } = props;

    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    const lambdaMemory = envConfig.lambdaMemory;

    const logGroup = new logs.LogGroup(this, "web-app-log-group", {
      logGroupName: `/aws/lambda/${id}-web-app-function`,
      retention: envConfig.logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // S3 bucket for static assets
    const assetsBucket = new s3.Bucket(this, "remix-assets-bucket", {
      bucketName: `${id}-remix-assets-bucket`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
    });

    assetsBucket.addLifecycleRule({
      noncurrentVersionExpiration: cdk.Duration.days(7),
    });

    const assetCacheTtl = cdk.Duration.days(envConfig.assetsCacheTtlDays);

    // Use DnsStack's hosted zone and certificate if provided
    let hostedZone: route53.IHostedZone | undefined;
    let certificate: acm.Certificate | undefined;

    if (props.dnsStack) {
      hostedZone = props.dnsStack.hostedZone;
      certificate = props.dnsStack.certificate;
    }

    // Lambda Web Adapter layer for proper HTTP streaming support
    const webAdapterLayer = LayerVersion.fromLayerVersionArn(
      this,
      "lambda-web-adapter",
      `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:25`,
    );

    // Lambda function for the web app
    const remixFunction = new lambda.Function(this, "mcp-server-function", {
      functionName: `${id}-web-app-function`,
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../dist/lambda-pkg"),
      ),
      handler: "run.sh",
      runtime: Runtime.NODEJS_24_X,
      memorySize: lambdaMemory,
      timeout: cdk.Duration.seconds(30),
      architecture: Architecture.X86_64,
      environment: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || "",
        TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || "",
        JWT_SECRET_ARN: secretsStack.jwtSecretArn,
        JWT_EXPIRY_HOURS: "1",
        LLM_STREAM_URL: llmStreamStack.functionUrl.url,
        MCP_PROXY_ENDPOINT: mcpProxyStack.proxyEndpoint,
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        PORT: "8080",
        AWS_LWA_ASYNC_INIT: "true",
      },
      layers: [webAdapterLayer],
      logGroup,
    });

    // Grant Lambda function read access to JWT secret
    secretsStack.jwtSecret.grantRead(remixFunction);

    // HTTP API Gateway (v2) — no custom domain, CloudFront is the front door
    const httpApi = new apigatewayv2.HttpApi(this, "remix-http-api", {
      description: "HTTP API for Remix app",
      createDefaultStage: false,
    });

    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      "remix-integration",
      remixFunction,
    );

    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    new apigatewayv2.HttpStage(this, "remix-stage", {
      httpApi,
      stageName: "$default",
      autoDeploy: true,
    });

    // Extract API Gateway hostname for CloudFront origin
    const apiGatewayHostname = cdk.Fn.select(
      2,
      cdk.Fn.split("/", httpApi.apiEndpoint),
    );

    // Shared S3 origin with OAC for static assets
    const s3Origin =
      origins.S3BucketOrigin.withOriginAccessControl(assetsBucket);

    // Cache policy for versioned/long-lived static assets
    const assetsCachePolicy = new cloudfront.CachePolicy(
      this,
      "assets-cache-policy",
      {
        defaultTtl: assetCacheTtl,
        maxTtl: assetCacheTtl,
        minTtl: cdk.Duration.seconds(0),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      },
    );

    // Static asset behavior (S3 origin, long-lived cache)
    const staticBehavior: cloudfront.BehaviorOptions = {
      origin: s3Origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy: assetsCachePolicy,
    };

    // CloudFront is the public front door
    // Default behavior → API Gateway (dynamic SSR + API routes)
    // Static path behaviors → S3 (no Lambda involvement, no redirects)
    const distribution = new cloudfront.Distribution(
      this,
      "remix-assets-distribution",
      {
        ...(envConfig.domainName && certificate
          ? { domainNames: [envConfig.domainName], certificate }
          : {}),
        defaultBehavior: {
          origin: new origins.HttpOrigin(apiGatewayHostname, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        additionalBehaviors: {
          "/assets/*": staticBehavior,
          "/fonts/*": staticBehavior,
          "/avatars/*": staticBehavior,
          "/favicon.ico": staticBehavior,
          "/robots.txt": staticBehavior,
          "/sitemap.xml": staticBehavior,
          "/theme-init.js": staticBehavior,
        },
        defaultRootObject: undefined,
      },
    );

    // Deploy static assets to S3 bucket
    const assetsDeployment = new s3deploy.BucketDeployment(
      this,
      "remix-assets-deployment",
      {
        sources: [
          s3deploy.Source.asset(path.join(__dirname, "../../../public")),
          s3deploy.Source.asset(path.join(__dirname, "../../../dist/client"), {
            exclude: ["**/*.html"],
          }),
        ],
        destinationBucket: assetsBucket,
        distribution,
        distributionPaths: ["/*"],
      },
    );

    // Versioned bucket requires DeleteObjectVersion for the --delete sync flag
    assetsDeployment.handlerRole?.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["s3:DeleteObjectVersion"],
        resources: [assetsBucket.arnForObjects("*")],
      }),
    );

    // Route53 A record pointing the domain to CloudFront
    if (envConfig.domainName && hostedZone) {
      new route53.ARecord(this, "api-alias-record", {
        zone: hostedZone,
        recordName: envConfig.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
      });
    }

    // Outputs
    new cdk.CfnOutput(this, "remix-function-api", {
      description: "HTTP API endpoint URL for Remix function",
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, "remix-function-arn", {
      description: "Remix Lambda Function ARN",
      value: remixFunction.functionArn,
    });

    new cdk.CfnOutput(this, "remix-cloudfront-url", {
      description: "CloudFront distribution URL",
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
