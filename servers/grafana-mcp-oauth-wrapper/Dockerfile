# Use Node.js 22 as the base image
FROM public.ecr.aws/docker/library/node:22-slim

# Set working directory
WORKDIR /app

# Install required packages including curl for health checks
RUN apt-get update && apt-get install -y curl wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Download and install Grafana MCP server binary
RUN wget https://github.com/grafana/mcp-grafana/releases/latest/download/mcp-grafana_Linux_x86_64.tar.gz -O /tmp/mcp-grafana.tar.gz && \
    tar -xzf /tmp/mcp-grafana.tar.gz -C /tmp && \
    mv /tmp/mcp-grafana /usr/local/bin/mcp-grafana && \
    chmod +x /usr/local/bin/mcp-grafana && \
    rm /tmp/mcp-grafana.tar.gz

# Copy package files
COPY package.json .
COPY package-lock.json* .
COPY tsconfig.json .

# Install dependencies
RUN npm ci

# Copy source files
COPY src/ ./src/

# Build TypeScript code
RUN npm run build

# Create a non-root user and group
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

# Set appropriate ownership
RUN chown -R appuser:appgroup /app

# Set environment variables
ENV PORT=8080
ENV BASE_PATH=""
ENV NODE_ENV=production

# Expose port for container
EXPOSE 8080

# Switch to non-root user
USER appuser

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080${BASE_PATH}/health || exit 1

# Run the OAuth wrapper
CMD ["node", "build/index.js"]
