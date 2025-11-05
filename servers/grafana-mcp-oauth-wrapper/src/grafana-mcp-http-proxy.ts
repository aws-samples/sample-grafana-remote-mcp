import { spawn, ChildProcess } from 'child_process';

export interface GrafanaMcpHttpProxyConfig {
  grafanaServiceAccountToken: string;
  grafanaUrl: string;
  mcpServerPort?: number;
}

export class GrafanaMcpHttpProxy {
  private mcpProcess: ChildProcess | null = null;
  private isInitialized = false;
  private mcpServerUrl: string;

  constructor(private config: GrafanaMcpHttpProxyConfig) {
    const port = config.mcpServerPort || 3001;
    this.mcpServerUrl = `http://localhost:${port}/mcp`;
  }

  private async initializeMcpServer(): Promise<void> {
    if (this.isInitialized && this.mcpProcess && !this.mcpProcess.killed) {
      console.log('MCP server already initialized and running, skipping initialization');
      return;
    }

    console.log(`MCP server needs initialization. Current state: initialized=${this.isInitialized}, process=${!!this.mcpProcess}, killed=${this.mcpProcess?.killed}`);

    const port = this.config.mcpServerPort || 3001;

    console.log(`Starting MCP server on port ${port} with Grafana URL: ${this.config.grafanaUrl}`);
    
    // Start Grafana MCP server with HTTP transport - use --address 0.0.0.0:port to bind to all interfaces
    this.mcpProcess = spawn('mcp-grafana', ['-t', 'streamable-http', '--address', `0.0.0.0:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GRAFANA_URL: this.config.grafanaUrl,
        GRAFANA_SERVICE_ACCOUNT_TOKEN: this.config.grafanaServiceAccountToken
      }
    });

    this.mcpProcess.stdout?.on('data', (data) => {
      console.log('MCP Server STDOUT:', data.toString().trim());
    });

    this.mcpProcess.stderr?.on('data', (data) => {
      console.error('MCP Server STDERR:', data.toString().trim());
    });

    this.mcpProcess.on('exit', (code, signal) => {
      console.log(`MCP server exited with code ${code}, signal ${signal}`);
      this.isInitialized = false;
    });

    this.mcpProcess.on('error', (error) => {
      console.error('MCP server spawn error:', error);
      this.isInitialized = false;
    });

    // Add process debugging
    console.log(`MCP process PID: ${this.mcpProcess.pid}`);
    console.log(`MCP process command: mcp-grafana -t streamable-http --address 0.0.0.0:${port}`);

    // Wait for server to start
    await this.waitForServer();
    this.isInitialized = true;
  }

  private async waitForServer(): Promise<void> {
    const maxRetries = 10;
    const retryDelay = 500;

    console.log(`Waiting for MCP server to start at ${this.mcpServerUrl}`);
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Connection attempt ${i + 1}/${maxRetries} to ${this.mcpServerUrl}`);
        
        // Try to connect to the streamable-http endpoint with POST only
        const response = await fetch(`${this.mcpServerUrl}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
        });
        
        console.log(`Response status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          console.log('MCP server is ready!');
          return;
        } else {
          const errorText = await response.text();
          console.log(`Response body: ${errorText.substring(0, 500)}`);
        }
      } catch (error) {
        console.log(`Connection attempt ${i + 1} failed:`, error instanceof Error ? error.message : error);
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
    throw new Error('MCP server failed to start');
  }

  async handleMcpRequest(requestBody: any): Promise<Response> {
    await this.initializeMcpServer();

    console.log(`Forwarding request to MCP server:`, requestBody);

    try {
      const response = await fetch(`${this.mcpServerUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`MCP server response: ${response.status} ${response.statusText}`);
      
      const responseBody = await response.text();
      console.log(`MCP server response body length: ${responseBody.length}`);
      console.log(`MCP server response body:`, responseBody);

      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (error) {
      console.error(`MCP server request failed:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      this.mcpProcess = null;
      this.isInitialized = false;
    }
  }
}
