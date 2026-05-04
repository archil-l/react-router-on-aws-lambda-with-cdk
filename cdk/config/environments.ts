/**
 * Per-Environment Configuration for CDK Deployments
 *
 * Fill in your AWS account ID, region, and domain settings before deploying.
 * The stage is selected via --context environment=prod when running CDK commands.
 */

import * as logs from "aws-cdk-lib/aws-logs";

export enum Stage {
  prod = "prod",
}

export interface EnvironmentConfig {
  /** Environment stage name */
  stage: Stage;
  /** AWS Account ID */
  accountId: string;
  /** AWS Region */
  region: string;
  /** Lambda memory in MB */
  lambdaMemory: number;
  /** CloudWatch Logs retention */
  logRetention: logs.RetentionDays;
  /** CloudFront HTML cache TTL in minutes */
  htmlCacheTtlMinutes: number;
  /** CloudFront assets cache TTL in days */
  assetsCacheTtlDays: number;
  /** Custom domain name (optional) */
  domainName?: string;
}

const environments: Record<Stage, EnvironmentConfig> = {
  [Stage.prod]: {
    stage: Stage.prod,
    accountId: "YOUR_AWS_ACCOUNT_ID",       // e.g. "123456789012"
    region: "us-east-1",
    lambdaMemory: 1024,
    logRetention: logs.RetentionDays.ONE_MONTH,
    htmlCacheTtlMinutes: 60,
    assetsCacheTtlDays: 30,
    // domainName: "your-app.example.com",
  },
};

/**
 * Get environment configuration by stage
 */
export function getEnvironmentConfig(stage: string): EnvironmentConfig {
  if (stage !== "prod") {
    throw new Error(`Invalid stage "${stage}". Must be "prod".`);
  }

  const config = environments[stage as Stage];

  if (!config) {
    throw new Error(`Production configuration not found for stage: ${stage}`);
  }

  return config;
}

/**
 * Get all environment configurations
 */
export function getAllEnvironments(): Record<Stage, EnvironmentConfig> {
  return environments;
}

export default getEnvironmentConfig;
