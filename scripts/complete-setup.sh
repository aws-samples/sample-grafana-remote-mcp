#!/bin/bash
set -e

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

echo "🚀 Deploying Grafana MCP Server..."
cdk deploy --all \
  --context grafanaUrl="$GRAFANA_URL" \
  --context grafanaApiKey="$GRAFANA_API_KEY" \
  --context mcpTransport=http \
  --require-approval never

echo "✅ Grafana MCP Workshop environment fully deployed!"
