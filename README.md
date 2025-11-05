# Grafana MCP Server with Cognito for OAuth 2.1 AuthN/AuthZ

This CDK project deploys a secure, production-ready Grafana MCP (Model Context Protocol) server with OAuth 2.1 authentication on AWS. It follows the [AWS Solutions Library guidance for deploying MCP servers](https://github.com/aws-solutions-library-samples/guidance-for-deploying-model-context-protocol-servers-on-aws) and is designed for integration with an Agent / LLM.

## Architecture Overview

The solution implements a four-stack architecture with the following components:

### **Security Layer**
- **AWS Cognito User Pool**: OAuth 2.1 authorization server with MFA support
- **Resource Server**: Defines OAuth scopes (`grafana-mcp-server/read`, `grafana-mcp-server/write`)
- **WAF Protection**: Both Application Load Balancer and CloudFront levels

### **Infrastructure Layer**
- **ECS Fargate**: Serverless container hosting for the MCP server
- **Application Load Balancer**: SSL termination and traffic distribution
- **CloudFront**: Global CDN with additional WAF protection
- **VPC**: Isolated network with public/private subnets

### **Application Layer**
- **OAuth Wrapper**: Validates JWT tokens from Cognito
- **Grafana MCP Proxy**: Interfaces with official Grafana MCP server
- **Transport Options**: Choose between stdio or HTTP transport modes

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 22+ and npm
- AWS CDK v2 installed (`npm install -g aws-cdk`)
- Docker installed (for building container images)
- A Grafana instance with service account token

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Bootstrap CDK (if not done before)

```bash
cdk bootstrap
```

### 3. Deploy with Required Parameters

#### **Basic Deployment**
```bash
cdk deploy --all \
  --context grafanaUrl=https://your-grafana-instance.com \
  --context grafanaApiKey=your-service-account-token \
  --context mcpTransport=http
```

#### **Advanced Deployment with Existing VPC**
```bash
cdk deploy --all \
  --context existingVpcId=vpc-12345678 \
  --context publicSubnetIds=subnet-12345,subnet-67890 \
  --context privateSubnetIds=subnet-abcde,subnet-fghij \
  --context grafanaUrl=https://your-grafana-instance.com \
  --context grafanaApiKey=your-service-account-token \
  --context mcpTransport=stdio
```

## Deployment Parameters

### **Required Parameters**

| Parameter       | Description                   | Example                       |
| --------------- | ----------------------------- | ----------------------------- |
| `grafanaUrl`    | Your Grafana instance URL     | `https://grafana.company.com` |
| `grafanaApiKey` | Grafana service account token | `glsa_xxx...`                 |

### **Optional Parameters**

| Parameter          | Description                              | Default | Options                 |
| ------------------ | ---------------------------------------- | ------- | ----------------------- |
| `mcpTransport`     | MCP server transport mode                | `stdio` | `stdio`, `http`         |
| `existingVpcId`    | Use existing VPC instead of creating new | -       | `vpc-12345678`          |
| `publicSubnetIds`  | Comma-separated public subnet IDs        | -       | `subnet-123,subnet-456` |
| `privateSubnetIds` | Comma-separated private subnet IDs       | -       | `subnet-abc,subnet-def` |

## How to Get Parameter Values

### **1. Grafana Service Account Token**
```bash
# In Grafana UI:
# 1. Go to Administration → Service Accounts
# 2. Create new service account with "Admin" role
# 3. Generate token and copy the value
```

### **2. Grafana URL**
```bash
# Your Grafana instance URL (publicly accessible)
# Examples:
# - https://grafana.company.com
# - https://your-grafana-instance.grafana.net
# - http://localhost:3000 (for testing)
```

### **3. Existing VPC Information (Optional)**
```bash
# List VPCs
aws ec2 describe-vpcs --query 'Vpcs[*].[VpcId,Tags[?Key==`Name`].Value|[0]]' --output table

# List subnets for a VPC
aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-12345678" \
  --query 'Subnets[*].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]' --output table
```

## Transport Mode Selection

### **stdio Transport (Default)**
- Traditional MCP communication via stdin/stdout
- Process-based communication
- More complex but follows MCP standards

```bash
cdk deploy --all --context mcpTransport=stdio
```

### **HTTP Transport (Recommended)**
- Modern HTTP-based communication
- Simpler proxy architecture
- Better for production scaling

```bash
cdk deploy --all --context mcpTransport=http
```

## Post-Deployment Configuration

### **1. Get Deployment Outputs**
```bash
# After deployment, note these outputs:
# - CloudFront Distribution URL
# - Cognito User Pool ID
# - Cognito User Pool Client ID
```

### **2. Configure Agent/LLM Integration**
```bash
# Use the CloudFront URL as your MCP server endpoint
# Example: https://d123456789.cloudfront.net
```

### **3. OAuth Discovery Endpoint**
```bash
# Agents can auto-discover OAuth configuration from:
# https://your-cloudfront-url/.well-known/oauth-protected-resource
```

## Testing the Deployment

### **Automated Testing**
```bash
# Run comprehensive OAuth 2.1 and MCP server tests
node test/test-mcp-server.js
```

### **Manual Testing**

### **1. OAuth Discovery**
```bash
curl https://your-cloudfront-url/grafana/mcp/.well-known/oauth-protected-resource
```

### **2. MCP Endpoint (should return 401)**
```bash
curl https://your-cloudfront-url/grafana/mcp/
```

### **3. OAuth Flow Testing**
Use tools like Insomnia or Postman to test the complete OAuth 2.1 flow:
1. Get authorization code from Cognito
2. Exchange for access token
3. Use token to access MCP endpoints

## Stack Dependencies

The deployment creates four stacks in this order:

1. **Grafana-MCP-VPC**: Network infrastructure
2. **Grafana-MCP-Security**: Cognito User Pool and security
3. **Grafana-MCP-CloudFront-WAF**: WAF rules (deployed to us-east-1)
4. **Grafana-MCP-Server**: Main application stack

## Cost Estimation

Estimated monthly costs for moderate usage:
- **ECS Fargate**: $20-40
- **Application Load Balancer**: $20
- **CloudFront**: $10-20
- **Cognito**: $5-10
- **Other services**: $10-15

**Total**: ~$65-105/month

## Security Features

✅ **OAuth 2.1 Compliant**: RFC9728 protected resource metadata  
✅ **Multi-layer WAF**: CloudFront and ALB protection  
✅ **VPC Isolation**: Private subnets for application tier  
✅ **Encrypted Storage**: All data encrypted at rest and in transit  
✅ **Non-root Containers**: Security-hardened container images  
✅ **Secrets Management**: Secure token storage via AWS Secrets Manager  

## Troubleshooting

### **Common Issues**

1. **Grafana Connection Failed**
   - Verify Grafana URL is publicly accessible
   - Check service account token permissions

2. **OAuth Token Validation Failed**
   - Ensure correct Cognito User Pool configuration
   - Verify token scopes include `grafana-mcp-server/read` or `/write`

3. **Container Health Check Failed**
   - Check ECS task logs in CloudWatch
   - Verify environment variables are set correctly

### **Useful Commands**

```bash
# View stack outputs
cdk list
aws cloudformation describe-stacks --stack-name Grafana-MCP-Server

# Check ECS service logs
aws logs tail /ecs/grafana-mcp-oauth-wrapper --follow

# Test MCP transport
docker run -it --rm \
  -e GRAFANA_URL=https://your-grafana.com \
  -e GRAFANA_TOKEN=your-token \
  your-image:latest
```

## Cleanup

```bash
# Destroy all stacks
cdk destroy --all

# Or destroy specific stack
cdk destroy Grafana-MCP-Server
```

## Support

For issues related to:
- **CDK deployment**: Check AWS CloudFormation console
- **Grafana MCP server**: See [official Grafana MCP documentation](https://github.com/grafana/mcp-grafana)
- **OAuth 2.1 specification**: Refer to [RFC9728](https://tools.ietf.org/rfc/rfc9728.txt)

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.