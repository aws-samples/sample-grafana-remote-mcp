import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { OAuthValidator } from './oauth-validator';
import { GrafanaMcpProxy } from './grafana-mcp-proxy';
import { GrafanaMcpHttpProxy } from './grafana-mcp-http-proxy';

const app = new Hono();
const port = parseInt(process.env.PORT || '8080');
const basePath = process.env.BASE_PATH || '';
const mcpTransport = process.env.MCP_TRANSPORT || 'stdio'; // 'stdio' or 'http'

// Initialize OAuth validator
const oauthValidator = new OAuthValidator({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  region: process.env.AWS_REGION!,
});

// Initialize appropriate Grafana MCP proxy based on transport
const grafanaProxy = mcpTransport === 'http' 
  ? new GrafanaMcpHttpProxy({
      grafanaServiceAccountToken: process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN!,
      grafanaUrl: process.env.GRAFANA_URL || 'http://localhost:3000',
      mcpServerPort: parseInt(process.env.MCP_SERVER_PORT || '3001'),
    })
  : new GrafanaMcpProxy({
      grafanaServiceAccountToken: process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN!,
      grafanaUrl: process.env.GRAFANA_URL || 'http://localhost:3000',
    });

console.log(`Using MCP transport: ${mcpTransport}`);

// Health check endpoint
app.get(`${basePath}/health`, (c) => {
  return c.json({ 
    status: 'healthy', 
    transport: mcpTransport,
    timestamp: new Date().toISOString() 
  });
});

// OAuth 2.0 Protected Resource Metadata endpoint (RFC9728)
app.get(`${basePath}/.well-known/oauth-protected-resource`, (c) => {
  const baseUrl = `${c.req.header('x-forwarded-proto') || 'https'}://${c.req.header('host')}${basePath}`;
  
  return c.json({
    resource: baseUrl,
    authorization_servers: [`https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`],
    scopes_supported: ['mcp-server/read', 'mcp-server/write'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl}/docs`,
  });
});

// MCP endpoints with OAuth protection
app.use(`${basePath}/*`, async (c, next) => {
  // Skip authentication for health check and well-known endpoints
  if (c.req.path.endsWith('/health') || c.req.path.includes('/.well-known/')) {
    return next();
  }

  // Validate OAuth token
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    c.header('WWW-Authenticate', 'Bearer realm="grafana-mcp-server", error="invalid_token"');
    return c.json({ error: 'invalid_token', error_description: 'Missing or invalid authorization header' }, 401);
  }

  const token = authHeader.substring(7);
  
  try {
    const tokenPayload = await oauthValidator.validateToken(token);
    (c as any).set('tokenPayload', tokenPayload);
    return next();
  } catch (error) {
    c.header('WWW-Authenticate', 'Bearer realm="grafana-mcp-server", error="invalid_token"');
    return c.json({ 
      error: 'invalid_token', 
      error_description: error instanceof Error ? error.message : 'Token validation failed' 
    }, 401);
  }
});

// Proxy MCP requests to Grafana MCP server
app.post(`${basePath}/`, async (c) => {
  try {
    const body = await c.req.json();
    console.log(`Received request body:`, body);
    console.log(`Request headers:`, c.req.header());
    const response = await grafanaProxy.handleMcpRequest(body);
    return response;
  } catch (error) {
    console.error('MCP request error:', error);
    return c.json({ 
      error: 'internal_error', 
      error_description: 'Failed to process MCP request' 
    }, 500);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await grafanaProxy.shutdown();
  process.exit(0);
});

// Start server
console.log(`Starting Grafana MCP OAuth Wrapper on port ${port}`);
serve({
  fetch: app.fetch,
  port,
});

console.log(`Grafana MCP OAuth Wrapper is running on http://localhost:${port}${basePath}`);
