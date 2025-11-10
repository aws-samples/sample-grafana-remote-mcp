#!/bin/bash

STACK_OPERATION=$1

if [[ "$STACK_OPERATION" == "Create" || "$STACK_OPERATION" == "Update" ]]; then
    echo "🎓 Creating Grafana MCP Workshop Environment..."
    
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
    
    # Install and configure Podman (Docker-compatible)
    if ! command -v podman &> /dev/null; then
        echo "📦 Installing Podman..."
        sudo yum install -y podman
        sudo systemctl start podman
        sudo systemctl enable podman
    fi
    
    # Create Docker symlink for CDK compatibility
    if ! command -v docker &> /dev/null; then
        echo "🔗 Creating Docker symlink to Podman..."
        sudo ln -sf /usr/bin/podman /usr/local/bin/docker
    fi
    
    # Run complete setup (handles Podman/Docker setup)
    ./scripts/complete-setup.sh
   
elif [ "$STACK_OPERATION" == "Delete" ]; then
    echo "🧹 Cleaning up workshop..."
    cd /home/ec2-user/environment
    cdk destroy --all --force || true
   
else
    echo "Invalid stack operation!"
    exit 1
fi
