#!/bin/bash

STACK_OPERATION=$1

if [[ "$STACK_OPERATION" == "Create" || "$STACK_OPERATION" == "Update" ]]; then
    echo "🎓 Creating Grafana MCP Workshop Environment..."
    
    # Install system dependencies
    sudo yum install -y jq git
    
    # Check Docker and install if needed
    if ! command -v docker &> /dev/null; then
        echo "📦 Installing Docker..."
        sudo yum install -y docker
        sudo systemctl start docker
        sudo systemctl enable docker
        sudo usermod -a -G docker ec2-user
    else
        echo "✅ Docker already installed"
    fi
    
    # Check Node.js version and install if needed
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$NODE_VERSION" -lt 22 ]]; then
            echo "📦 Node.js version $NODE_VERSION detected. Installing Node.js 22 LTS..."
            curl -sL https://rpm.nodesource.com/setup_22.x | sudo bash -
            sudo yum install -y nodejs
        else
            echo "✅ Node.js $NODE_VERSION detected"
        fi
    else
        echo "📦 Installing Node.js 22 LTS..."
        curl -sL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo yum install -y nodejs
    fi
    
    # Install AWS CDK
    sudo npm install -g aws-cdk
    
    # Run complete setup
    ./scripts/complete-setup.sh
   
elif [ "$STACK_OPERATION" == "Delete" ]; then
    echo "🧹 Cleaning up workshop..."
    cd /home/ec2-user/environment
    cdk destroy --all --force || true
   
else
    echo "Invalid stack operation!"
    exit 1
fi
