import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { EnvironmentConfig } from "../config/environments.js";
import { SecretsStack } from "./secrets-stack.js";

interface LLMStreamStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
  secretsStack: SecretsStack;
}

export class LLMStreamStack extends cdk.Stack {
  public readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: LLMStreamStackProps) {
    super(scope, id, props);

    const { envConfig, secretsStack } = props;

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

    const conversationsBucket = new s3.Bucket(this, "conversations-bucket", {
      bucketName: `${id}-conversations`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const logGroup = new logs.LogGroup(this, "llm-stream-log-group", {
      logGroupName: `/aws/lambda/${id}-llm-stream-function`,
      retention: envConfig.logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda function for LLM streaming
    const streamingFunction = new lambda.Function(this, "llm-stream-function", {
      functionName: `${id}-llm-stream-function`,
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../dist/streaming-lambda"),
      ),
      handler: "streaming-handler.handler",
      runtime: Runtime.NODEJS_24_X,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5), // Longer timeout for streaming responses
      architecture: Architecture.X86_64,
      environment: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        NODE_ENV: "production",
        JWT_SECRET_ARN: secretsStack.jwtSecretArn,
        // MCP Server configuration
        MCP_SERVER_URL: cdk.Fn.join("", [mcpServerFunctionUrl, "mcp"]),
        // Client access role for assuming temporary credentials
        CLIENT_ACCESS_ROLE_ARN: clientAccessRoleArn,
        CONVERSATIONS_BUCKET_NAME: conversationsBucket.bucketName,
      },
      logGroup,
    });

    // Grant permission to invoke MCP server Lambda Function URL
    streamingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunctionUrl"],
        resources: [mcpServerFunctionArn],
      }),
    );

    // Grant permission to assume the MCP server client access role
    streamingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [clientAccessRoleArn],
      }),
    );

    // Grant Lambda function read access to JWT secret
    secretsStack.jwtSecret.grantRead(streamingFunction);

    // Grant Lambda function write access to conversations bucket
    conversationsBucket.grantPut(streamingFunction);

    // Add Function URL with streaming enabled
    this.functionUrl = streamingFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["Content-Type", "Authorization"],
        allowCredentials: true,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, "llm-stream-function-url", {
      description: "Lambda Function URL for LLM streaming",
      value: this.functionUrl.url,
    });

    new cdk.CfnOutput(this, "llm-stream-function-arn", {
      description: "LLM Streaming Lambda Function ARN",
      value: streamingFunction.functionArn,
    });
  }
}
