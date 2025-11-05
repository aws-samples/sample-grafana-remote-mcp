import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface GrafanaMcpProxyConfig {
  grafanaServiceAccountToken: string;
  grafanaUrl: string;
}

export interface McpRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: string;
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class GrafanaMcpProxy extends EventEmitter {
  private mcpProcess: ChildProcess | null = null;
  private isInitialized = false;
  private pendingRequests = new Map<string | number, (response: McpResponse) => void>();

  constructor(private config: GrafanaMcpProxyConfig) {
    super();
  }

  private async initializeMcpServer(): Promise<void> {
    if (this.isInitialized) return;

    // Start the actual Grafana MCP server process
    this.mcpProcess = spawn('mcp-grafana', ['-t', 'stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GRAFANA_URL: this.config.grafanaUrl,
        GRAFANA_SERVICE_ACCOUNT_TOKEN: this.config.grafanaServiceAccountToken
      }
    });

    if (!this.mcpProcess.stdout || !this.mcpProcess.stdin) {
      throw new Error('Failed to initialize MCP server process');
    }

    // Handle responses from the MCP server
    this.mcpProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter((line: string) => line.trim());
      
      for (const line of lines) {
        try {
          const response: McpResponse = JSON.parse(line);
          const resolver = this.pendingRequests.get(response.id);
          if (resolver) {
            resolver(response);
            this.pendingRequests.delete(response.id);
          }
        } catch (error) {
          console.error('Failed to parse MCP response:', error);
        }
      }
    });

    this.mcpProcess.stderr?.on('data', (data) => {
      console.error('MCP Server Error:', data.toString());
    });

    this.mcpProcess.on('exit', (code) => {
      console.log(`MCP server exited with code ${code}`);
      this.isInitialized = false;
    });

    this.isInitialized = true;
  }

  async handleMcpRequest(request: any): Promise<Response> {
    await this.initializeMcpServer();

    if (!this.mcpProcess?.stdin) {
      throw new Error('MCP server not properly initialized');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('MCP request timeout'));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(request.id, (response) => {
        clearTimeout(timeout);
        resolve(new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      });

      // Send request to the actual Grafana MCP server
      this.mcpProcess!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  async shutdown(): Promise<void> {
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      this.mcpProcess = null;
      this.isInitialized = false;
    }
  }
}
