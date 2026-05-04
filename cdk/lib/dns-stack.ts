import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";

export interface DnsStackProps extends cdk.StackProps {
  domainName: string;
}

/**
 * DNS Stack - hosted zone + ACM certificate for a domain you own.
 *
 * Deploy this once. After deploying, copy the nameservers from the output
 * and set them at your registrar (or parent hosted zone).
 *
 * The ACM certificate covers the apex domain and all subdomains (*.domainName).
 */
export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { domainName } = props;

    this.hostedZone = new route53.HostedZone(this, "hosted-zone", {
      zoneName: domainName,
    });

    this.certificate = new acm.Certificate(this, "certificate", {
      domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    const sanitized = domainName.replace(/\./g, "-");

    new cdk.CfnOutput(this, "hosted-zone-id", {
      description: `Hosted Zone ID for ${domainName}`,
      value: this.hostedZone.hostedZoneId,
      exportName: `${sanitized}-zone-id`,
    });

    new cdk.CfnOutput(this, "nameservers", {
      description: `Nameservers for ${domainName} — copy these to your registrar`,
      value: cdk.Fn.join(", ", this.hostedZone.hostedZoneNameServers ?? []),
      exportName: `${sanitized}-nameservers`,
    });

    new cdk.CfnOutput(this, "certificate-arn", {
      description: `ACM Certificate ARN for ${domainName}`,
      value: this.certificate.certificateArn,
      exportName: `${sanitized}-certificate-arn`,
    });
  }
}
