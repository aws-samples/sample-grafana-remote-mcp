#!/bin/bash
set -e

case $STACK_OPERATION in
  create)
    echo "🎓 Creating Grafana MCP Workshop Environment..."
    
    # Install Node.js 22 LTS
    curl -sL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo yum install -y nodejs jq git docker
    
    # Start Docker
    sudo systemctl start docker
    sudo usermod -a -G docker ec2-user
    
    # Install AWS CDK
    sudo npm install -g aws-cdk
    
    # Clone and setup
    cd /home/ec2-user/environment
    git clone https://github.com/aws-samples/sample-grafana-remote-mcp.git grafana-mcp-workshop
    cd grafana-mcp-workshop
    
    npm install
    npm run build
    cdk bootstrap --require-approval never
    
    # Retrieve Grafana configuration from Parameter Store
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
    
    # Deploy with actual Grafana values
    echo "🚀 Deploying Grafana MCP Server..."
    cdk deploy --all \
      --context grafanaUrl="$GRAFANA_URL" \
      --context grafanaApiKey="$GRAFANA_API_KEY" \
      --context mcpTransport=http \
      --require-approval never
    
    echo "✅ Grafana MCP Workshop environment fully deployed!"
    ;;
    
  delete)
    echo "🧹 Cleaning up workshop..."
    cd /home/ec2-user/environment/grafana-mcp-workshop
    cdk destroy --all --force || true
    ;;
    
  *)
    echo "Unknown operation: $STACK_OPERATION"
    exit 1
    ;;
esac

