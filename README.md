# Grafana MCP Server with OAuth 2.1

Secure [Grafana MCP](https://github.com/grafana/mcp-grafana) (Model Context Protocol) server with OAuth 2.1 authentication on AWS, enabling AI agents to query Grafana dashboards, metrics, traces, and logs.

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  CloudFront  │────│     WAF      │────│     ALB      │
│     CDN      │    │  Protection  │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
                                               │
                    ┌──────────────────────────┴────────┐
                    │                                   │
                    ▼                                   ▼
            ┌──────────────┐                  ┌──────────────┐
            │   Cognito    │                  │  ECS Fargate │
            │  User Pool   │                  │              │
            │ (OAuth 2.1)  │                  │ ┌──────────┐ │
            └──────────────┘                  │ │  OAuth   │ │
                    │                         │ │ Wrapper  │ │
                    │ JWT Validation          │ └────┬─────┘ │
                    └─────────────────────────┤      │       │
                                              │      ▼       │
                                              │ ┌──────────┐ │
                                              │ │ Grafana  │ │
                                              │ │   MCP    │ │
                                              │ │  Server  │ │
                                              │ └──────────┘ │
                                              └──────────────┘
```

## Components

- **Cognito User Pool**: OAuth 2.1 authorization with MFA support
- **CloudFront + WAF**: Global CDN with multi-layer protection
- **ECS Fargate**: Serverless container hosting
- **OAuth Wrapper**: JWT token validation and proxying
- **Grafana MCP Server**: Official MCP server for Grafana integration

## Prerequisites

- AWS CLI configured
- AWS CDK installed: `npm install -g aws-cdk`
- Docker running
- **Grafana instance with service account token**: Deploy [sample-grafana-prometheus-stack](https://github.com/aws-samples/sample-grafana-prometheus-stack) if needed

## Deployment

### Automated Setup

```bash
scripts/complete-setup.sh
```

Retrieves Grafana configuration from Parameter Store (`/workshop/grafana-url`, `/workshop/grafana-api-key`) and deploys all stacks.

### Manual Deployment

```bash
cdk deploy --all \
  --context grafanaUrl=https://your-grafana-instance.com \
  --context grafanaApiKey=your-service-account-token \
  --context mcpTransport=http
```

### Optional: Use Existing VPC

```bash
cdk deploy --all \
  --context existingVpcId=vpc-12345678 \
  --context publicSubnetIds=subnet-123,subnet-456 \
  --context privateSubnetIds=subnet-abc,subnet-def \
  --context grafanaUrl=https://your-grafana-instance.com \
  --context grafanaApiKey=your-service-account-token
```

## Getting Grafana Credentials

### Service Account Token
In Grafana UI:
1. Go to **Administration → Service Accounts**
2. Create service account with **Admin** role
3. Generate token and copy value

### Grafana URL
Your publicly accessible Grafana instance URL (e.g., `https://grafana.company.com`)

## Accessing Your MCP Server

### Get CloudFront URL
```bash
aws cloudformation describe-stacks \
  --stack-name MCP-Server \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionUrl`].OutputValue' \
  --output text
```

### OAuth Discovery Endpoint
```bash
curl https://your-cloudfront-url/.well-known/oauth-protected-resource
```

### Test MCP Endpoint
```bash
# Should return 401 without valid token
curl https://your-cloudfront-url/grafana/mcp/
```

## Testing

```bash
node test/test-mcp-server.js
```

## Agentic Observability

This MCP server enables AI agents to interact with Grafana for:
- Querying dashboards and metrics
- Analyzing traces and logs
- Investigating incidents
- Providing intelligent troubleshooting

Works with the [sample-grafana-prometheus-stack](https://github.com/aws-samples/sample-grafana-prometheus-stack) for complete agentic observability.

## Security Features

✅ OAuth 2.1 compliant (RFC9728)  
✅ Multi-layer WAF protection  
✅ VPC isolation with private subnets  
✅ Encrypted at rest and in transit  
✅ Non-root containers  
✅ Secrets Manager integration  

## Cleanup

```bash
cdk destroy --all
```

## License

This library is licensed under the MIT-0 License. See the LICENSE file.