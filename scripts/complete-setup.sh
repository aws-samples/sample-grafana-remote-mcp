#!/bin/bash
set -e

echo "🔧 Installing dependencies..."

# Install and configure Podman (Docker-compatible) if not already installed
if ! command -v podman &> /dev/null; then
    echo "📦 Installing Podman..."
    sudo yum install -y podman
    sudo systemctl start podman
    sudo systemctl enable podman
fi

# Create Docker symlink for CDK compatibility if it doesn't exist
if ! command -v docker &> /dev/null; then
    echo "🔗 Creating Docker symlink to Podman..."
    sudo ln -sf /usr/bin/podman /usr/local/bin/docker
fi

# Install AWS CDK if not already installed
if ! command -v cdk &> /dev/null; then
    echo "📦 Installing AWS CDK..."
    npm install -g aws-cdk
fi

echo "📡 Retrieving Grafana configuration from Parameter Store..."

GRAFANA_URL=$(aws ssm get-parameter --name /workshop/grafana-url --query Parameter.Value --output text --region ${AWS_REGION:-us-west-2} 2>/dev/null || echo "")
GRAFANA_API_KEY=$(aws ssm get-parameter --name /workshop/grafana-api-key --with-decryption --query Parameter.Value --output text --region ${AWS_REGION:-us-west-2} 2>/dev/null || echo "")

if [ -z "$GRAFANA_URL" ] || [ -z "$GRAFANA_API_KEY" ]; then
  echo "⚠️  Grafana configuration not found in Parameter Store!"
  echo "Please ensure grafana-prometheus-stack workshop has been deployed and configured."
  echo ""
  echo "Required parameters:"
  echo "  /workshop/grafana-url"
  echo "  /workshop/grafana-api-key"
  exit 1
fi

echo "📦 Installing npm dependencies..."
npm install

echo "🔨 Building TypeScript project..."
npm run build

echo "🚀 Deploying Grafana MCP Server..."
cdk deploy --all \
  --context grafanaUrl="$GRAFANA_URL" \
  --context grafanaApiKey="$GRAFANA_API_KEY" \
  --context mcpTransport=http \
  --require-approval never

echo "✅ Grafana MCP Workshop environment fully deployed!"
