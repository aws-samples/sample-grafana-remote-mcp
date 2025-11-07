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
    
    # Setup workshop directory
    cd /home/ec2-user/environment
    
    # Install dependencies and build
    npm install
    npm run build
    
    # Bootstrap CDK
    cdk bootstrap --require-approval never
    
    # Run complete setup
    ./scripts/complete-setup.sh
    ;;
    
  delete)
    echo "🧹 Cleaning up workshop..."
    cd /home/ec2-user/environment
    cdk destroy --all --force || true
    ;;
    
  *)
    echo "Unknown operation: $STACK_OPERATION"
    exit 1
    ;;
esac

