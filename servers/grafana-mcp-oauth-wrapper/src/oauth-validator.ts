import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

export interface OAuthValidatorConfig {
  userPoolId: string;
  region: string;
}

export interface TokenPayload extends JWTPayload {
  client_id?: string;
  scope?: string;
  token_use?: string;
}

export class OAuthValidator {
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private issuer: string;

  constructor(private config: OAuthValidatorConfig) {
    this.issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async validateToken(token: string): Promise<TokenPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: undefined, // Cognito doesn't always set aud for client credentials
      });

      // Validate token type
      if (payload.token_use !== 'access') {
        throw new Error('Invalid token type');
      }

      // Validate required scopes
      const scopes = (payload.scope as string)?.split(' ') || [];
      const hasValidScope = scopes.some(scope => 
        scope === 'mcp-server/read' || scope === 'mcp-server/write'
      );

      if (!hasValidScope) {
        throw new Error('Insufficient scope');
      }

      return payload as TokenPayload;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Token validation failed: ${error.message}`);
      }
      throw new Error('Token validation failed');
    }
  }
}
