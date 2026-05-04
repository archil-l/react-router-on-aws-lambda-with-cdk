import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config/environments.js";

interface GitHubOidcStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
  githubOrg: string;
  githubRepo: string;
}

export class GitHubOidcStack extends cdk.Stack {
  public readonly role: iam.Role;
  public readonly oidcProvider: iam.IOpenIdConnectProvider;

  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const { githubOrg, githubRepo, envConfig } = props;

    // Create OIDC Identity Provider for GitHub Actions
    this.oidcProvider = new iam.OpenIdConnectProvider(
      this,
      "github-oidc-provider",
      {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
      },
    );

    // Create IAM Role for GitHub Actions
    this.role = new iam.Role(this, "github-actions-role", {
      roleName: `${id}-github-actions-role`,
      assumedBy: new iam.FederatedPrincipal(
        this.oidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${githubRepo}:*`,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
      description: `GitHub Actions OIDC role for ${envConfig.stage} environment`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("PowerUserAccess"),
      ],
    });

    // Add CloudFormation permissions (needed for CDK deployments)
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cloudformation:*",
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ],
        resources: ["*"],
      }),
    );

    // Add Lambda permissions
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "lambda:CreateFunction",
          "lambda:UpdateFunction",
          "lambda:UpdateFunctionCode",
          "lambda:DeleteFunction",
          "lambda:GetFunction",
          "lambda:InvokeFunction",
          "lambda:AddPermission",
          "lambda:RemovePermission",
        ],
        resources: ["*"],
      }),
    );

    // Add API Gateway permissions
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["apigateway:*", "apigatewayv2:*"],
        resources: ["*"],
      }),
    );

    // Add S3 permissions
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:CreateBucket",
          "s3:GetBucketVersioning",
          "s3:PutBucketVersioning",
          "s3:GetBucketPolicy",
          "s3:PutBucketPolicy",
          "s3:DeleteBucket",
          "s3:PutBucketCors",
          "s3:GetBucketCors",
        ],
        resources: ["*"],
      }),
    );

    // Add CloudFront permissions
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cloudfront:CreateDistribution",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
          "cloudfront:GetDistribution",
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
        ],
        resources: ["*"],
      }),
    );

    // Add CloudWatch Logs permissions
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DeleteLogGroup",
        ],
        resources: ["*"],
      }),
    );

    // Add IAM role passing permission (for Lambda execution role)
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: [
          `arn:aws:iam::${this.account}:role/${id}-lambda-execution-role`,
        ],
      }),
    );

    // Add IAM role creation/update permissions (for Lambda execution role)
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "iam:CreateRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRole",
          "iam:DeleteRole",
        ],
        resources: [`arn:aws:iam::${this.account}:role/${id}-*`],
      }),
    );

    // Add ACM certificate management permissions (for custom domains)
    this.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "acm:RequestCertificate",
          "acm:DescribeCertificate",
          "acm:DeleteCertificate",
          "acm:ListCertificates",
          "acm:AddTagsToCertificate",
        ],
        resources: ["*"],
      }),
    );

    // Output the role ARN for GitHub Secrets
    new cdk.CfnOutput(this, "github-actions-role-arn", {
      description: "ARN of the GitHub Actions IAM role (use in GitHub Secrets)",
      value: this.role.roleArn,
      exportName: `${id}-github-actions-role-arn`,
    });

    new cdk.CfnOutput(this, "oidc-provider-arn", {
      description: "ARN of the OIDC Identity Provider",
      value: this.oidcProvider.openIdConnectProviderArn,
    });
  }
}
