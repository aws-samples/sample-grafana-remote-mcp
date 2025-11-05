import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { McpFargateServerConstruct } from "../constructs/mcp-fargate-server-construct";
import { NagSuppressions } from "cdk-nag";
import { getAllowedCountries } from "../constants/geo-restrictions";

export interface MCPServerStackProps extends cdk.StackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  vpc: ec2.IVpc;
}

/**
 * Combined stack for MCP platform and servers to avoid circular dependencies
 */
export class MCPServerStack extends cdk.Stack {
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly cluster: ecs.Cluster;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MCPServerStackProps) {
    super(scope, id, props);

      // Get context variables for Grafana configuration
      const grafanaUrl = this.node.tryGetContext("grafanaUrl") || "https://your-grafana-instance.com";
      const grafanaApiKey = this.node.tryGetContext("grafanaApiKey") || "";
      const mcpTransport = this.node.tryGetContext("mcpTransport") || "stdio";

    // Get CloudFront WAF ARN from SSM (written by CloudFrontWafStack)
    const cloudFrontWafArnParam =
      ssm.StringParameter.fromStringParameterAttributes(
        this,
        "CloudFrontWafArnParam",
        {
          parameterName: `/mcp/cloudfront-waf-arn-${props.resourceSuffix}`,
        }
      );

    // Get Cognito User Pool ID from SSM (written by SecurityStack)
    const userPoolIdParam = ssm.StringParameter.fromStringParameterAttributes(
      this,
      "UserPoolIdParam",
      {
        parameterName: `/mcp/cognito/user-pool-id-${props.resourceSuffix}`,
      }
    );

    // Get Cognito User Pool Client ID from SSM (written by SecurityStack)
    const userPoolClientIdParam =
      ssm.StringParameter.fromStringParameterAttributes(
        this,
        "UserPoolClientIdParam",
        {
          parameterName: `/mcp/cognito/user-pool-client-id-${props.resourceSuffix}`,
        }
      );

    // Get Cognito User Pool Client Secret from Secrets Manager (written by SecurityStack)
    const userPoolClientSecret = cdk.aws_secretsmanager.Secret.fromSecretNameV2(
      this,
      "UserPoolClientSecret",
      `/mcp/cognito/user-pool-client-secret-${props.resourceSuffix}`
    );

    // Create shared ECS cluster for all MCP servers
    this.cluster = new ecs.Cluster(this, "MCPCluster", {
      vpc: props.vpc,
      //containerInsights: true,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    // Add suppression for Container Insight (Deprecated) not be enabled while Container Insight V2 is enabled
    NagSuppressions.addResourceSuppressions(this.cluster, [
      {
        id: "AwsSolutions-ECS4",
        reason:
          "Container Insights V2 is Enabled with Enhanced capabilities, the Nag findings is about Container Insights (v1) which is deprecated",
      },
    ]);

    // Create context parameters for multi-region certificate support
    const cdnCertificateArn = this.node.tryGetContext("cdnCertificateArn");
    const albCertificateArn = this.node.tryGetContext("albCertificateArn");
    const customDomain = this.node.tryGetContext("customDomain");

    // Validate certificate and domain requirements
    if ((cdnCertificateArn || albCertificateArn) && !customDomain) {
      throw new Error(
        "Custom domain name must be provided when using certificates. " +
          "CloudFront and ALB require a valid domain name for certificate association."
      );
    }

    // Validate CloudFront certificate is in us-east-1 if provided
    if (cdnCertificateArn) {
      const cfCertRegion = cdk.Arn.split(
        cdnCertificateArn,
        cdk.ArnFormat.SLASH_RESOURCE_NAME
      ).region;
      if (cfCertRegion !== "us-east-1") {
        throw new Error(
          `CloudFront certificate must be in us-east-1 region, but found in ${cfCertRegion}. ` +
            "Use cdnCertificateArn context parameter with a certificate from us-east-1."
        );
      }
    }

    // Validate ALB certificate is in the current stack region if provided
    if (albCertificateArn) {
      const albCertRegion = cdk.Arn.split(
        albCertificateArn,
        cdk.ArnFormat.SLASH_RESOURCE_NAME
      ).region;
      if (albCertRegion !== this.region) {
        throw new Error(
          `ALB certificate must be in the same region as the stack (${this.region}), but found in ${albCertRegion}. ` +
            "Use albCertificateArn context parameter with a certificate from the deployment region."
        );
      }
    }

    // Create HTTP and HTTPS security groups for the ALB
    const httpSecurityGroup = new ec2.SecurityGroup(
      this,
      `HttpSecurityGroup-${props.resourceSuffix}`,
      {
        vpc: props.vpc,
        allowAllOutbound: true,
        description: `HTTP Security group for MCP-Server Stack ALB`,
      }
    );

    const httpsSecurityGroup = new ec2.SecurityGroup(
      this,
      `HttpsSecurityGroup-${props.resourceSuffix}`,
      {
        vpc: props.vpc,
        allowAllOutbound: true,
        description: `HTTPS Security group for MCP-Server Stack ALB`,
      }
    );

    const cloudFrontPrefixList = ec2.PrefixList.fromLookup(
      this,
      "CloudFrontOriginFacing",
      {
        prefixListName: "com.amazonaws.global.cloudfront.origin-facing",
      }
    );

    // Add ingress rules to appropriate security group
    httpSecurityGroup.addIngressRule(
      ec2.Peer.prefixList(cloudFrontPrefixList.prefixListId),
      ec2.Port.tcp(80),
      "Allow HTTP traffic from CloudFront edge locations"
    );

    httpsSecurityGroup.addIngressRule(
      ec2.Peer.prefixList(cloudFrontPrefixList.prefixListId),
      ec2.Port.tcp(443),
      "Allow HTTPS traffic from CloudFront edge locations"
    );

    // Use the appropriate security group based on ALB certificate presence
    this.albSecurityGroup = albCertificateArn
      ? httpsSecurityGroup
      : httpSecurityGroup;

    // Create S3 bucket for ALB and CloudFront access logs with proper encryption and lifecycle rules
    const accessLogsBucket = new cdk.aws_s3.Bucket(this, "AccessLogsBucket", {
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev environment (use RETAIN for prod)
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30), // Retain logs for 30 days
        },
      ],
      serverAccessLogsPrefix: "server-access-logs/", // Separate prefix for server access logs
      objectOwnership: cdk.aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // Required for CloudFront logging
    });

    // Create Application Load Balancer dedicated to this MCP server
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      `ApplicationLoadBalancer`,
      {
        vpc: props.vpc,
        internetFacing: true,
        securityGroup: this.albSecurityGroup,
        http2Enabled: true,
      }
    );

    // Enable access logging to S3
    this.loadBalancer.logAccessLogs(accessLogsBucket);

    const paramName = `/mcp/https-url`;

    // ****************************************************************
    // Model Context Prototcol Server(s) built on ECS Fargate
    // ****************************************************************

    // Deploy the Grafana MCP server with CloudFront
    const grafanaServer = new McpFargateServerConstruct(
      this,
      "GrafanaMcpServer",
      {
        platform: {
          vpc: props.vpc,
          cluster: this.cluster,
        },
        serverName: "grafana-mcp",
        serverPath: path.join(
          __dirname,
          "../../servers/grafana-mcp-oauth-wrapper"
        ),
        healthCheckPath: "/grafana/mcp/health",
        environment: {
          PORT: "8080",
          BASE_PATH: "/grafana/mcp",
          AWS_REGION: this.region,
          COGNITO_USER_POOL_ID: userPoolIdParam.stringValue,
          COGNITO_CLIENT_ID: userPoolClientIdParam.stringValue,
          // MCP Transport Configuration
          MCP_TRANSPORT: mcpTransport,
          MCP_SERVER_PORT: '3001', // Internal port for HTTP transport
          // Grafana Configuration
          GRAFANA_URL: grafanaUrl,
          GRAFANA_SERVICE_ACCOUNT_TOKEN: grafanaApiKey,
        },
        secrets: {
          OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(userPoolClientSecret),
        },
        albSecurityGroup: this.albSecurityGroup,
        urlParameterName: paramName,
      }
    );

    // Create either HTTP or HTTPS listener based on ALB certificate presence
    const listener = albCertificateArn
      ? this.loadBalancer.addListener("HttpsListener", {
          port: 443,
          protocol: elbv2.ApplicationProtocol.HTTPS,
          certificates: [
            acm.Certificate.fromCertificateArn(
              this,
              "AlbCertificate",
              albCertificateArn
            ),
          ],
          open: false,
        })
      : this.loadBalancer.addListener("HttpListener", {
          port: 80,
          protocol: elbv2.ApplicationProtocol.HTTP,
          open: false,
        });

    // Add path-based routing rule for Grafana MCP server
    listener.addTargetGroups("GrafanaTargetGroup", {
      targetGroups: [grafanaServer.targetGroup],
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/grafana/mcp/*"]),
      ],
      priority: 100,
    });

    // Add default action for health checks and other paths
    listener.addAction("DefaultAction", {
      action: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "application/json",
        messageBody: JSON.stringify({ error: "Not Found" }),
      }),
    });

    // Create CloudFront distribution with protocol matching ALB listener
    const albOrigin = new origins.LoadBalancerV2Origin(this.loadBalancer, {
      protocolPolicy: albCertificateArn
        ? cloudfront.OriginProtocolPolicy.HTTPS_ONLY
        : cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      httpsPort: 443,
      connectionAttempts: 3,
      connectionTimeout: cdk.Duration.seconds(10),
      readTimeout: cdk.Duration.seconds(30),
      keepaliveTimeout: cdk.Duration.seconds(5),
    });

    const geoRestriction = cloudfront.GeoRestriction.allowlist(
      ...getAllowedCountries()
    );

    // Create the CloudFront distribution with conditional properties
    if (customDomain && cdnCertificateArn) {
      // With custom domain and CDN certificate
      const certificate = acm.Certificate.fromCertificateArn(
        this,
        `MCPServerStackCertificate`,
        cdnCertificateArn
      );

      this.distribution = new cloudfront.Distribution(
        this,
        `MCPServerStackDistribution`,
        {
          defaultBehavior: {
            origin: albOrigin,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          },
          domainNames: [customDomain],
          certificate: certificate,
          enabled: true,
          minimumProtocolVersion:
            cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
          priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
          comment: `CloudFront distribution for MCP-Server Stack with custom domain`,
          geoRestriction,
          webAclId: cloudFrontWafArnParam.stringValue,
          logBucket: accessLogsBucket,
          logFilePrefix: "cloudfront-logs/",
        }
      );
    } else {
      // Default CloudFront domain
      this.distribution = new cloudfront.Distribution(
        this,
        `MCPServerStackDistribution`,
        {
          defaultBehavior: {
            origin: albOrigin,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          },
          enabled: true,
          httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
          priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
          comment: `CloudFront distribution for MCP-Server stack`,
          geoRestriction,
          webAclId: cloudFrontWafArnParam.stringValue,
          logBucket: accessLogsBucket,
          logFilePrefix: "cloudfront-logs/",
        }
      );
    }

    // Add suppressions for CloudFront TLS warnings
    NagSuppressions.addResourceSuppressions(this.distribution, [
      {
        id: "AwsSolutions-CFR4",
        reason:
          "Development environment using default CloudFront certificate without custom domain - TLS settings are managed by CloudFront",
      },
      {
        id: "AwsSolutions-CFR5",
        reason:
          "Development environment using HTTP-only communication to ALB origin which is internal to VPC",
      },
    ]);

    // Create Route 53 records if custom domain and CDN certificate are provided
    if (customDomain && cdnCertificateArn) {
      // Look up the hosted zone
      const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: customDomain,
      });

      // Create A record for the custom domain
      new route53.ARecord(this, "McpServerARecord", {
        zone: hostedZone,
        recordName: customDomain,
        target: route53.RecordTarget.fromAlias(
          new route53targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // Set the HTTPS URL
    const httpsUrl =
      customDomain && cdnCertificateArn
        ? `https://${customDomain}`
        : `https://${this.distribution.distributionDomainName}`;

    // Output CloudFront distribution details
    new cdk.CfnOutput(this, "CloudFrontDistributions", {
      value: httpsUrl,
      description: "CloudFront HTTPS URLs for all MCP servers",
    });
  }
}
