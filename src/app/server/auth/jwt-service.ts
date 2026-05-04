import jwt from "jsonwebtoken";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

interface JWTPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
}

class JWTService {
  private secret: string | null = null;
  private currentToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private secretArn: string;
  private expiryHours: number;
  private secretsClient: SecretsManagerClient;

  constructor(secretArn: string, expiryHours: number = 1) {
    this.secretArn = secretArn;
    this.expiryHours = expiryHours;
    this.secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }

  /**
   * Initialize the service by fetching the JWT secret from Secrets Manager
   */
  async initialize(): Promise<void> {
    try {
      const secret = await this.fetchSecret();
      this.secret = secret;
      // Generate initial token
      this.generateToken();
    } catch (error) {
      console.error("Failed to initialize JWT service:", error);
      throw new Error("Failed to initialize JWT service");
    }
  }

  /**
   * Fetch the JWT signing secret from AWS Secrets Manager
   */
  private async fetchSecret(): Promise<string> {
    // Local dev shortcut: use raw secret directly, skip Secrets Manager
    if (process.env.JWT_SECRET) {
      return process.env.JWT_SECRET;
    }

    try {
      const command = new GetSecretValueCommand({
        SecretId: this.secretArn,
      });
      const response = await this.secretsClient.send(command);

      if (response.SecretString) {
        const secretJson = JSON.parse(response.SecretString);
        return secretJson.secret;
      }

      throw new Error("Secret does not have a SecretString");
    } catch (error) {
      console.error("Failed to fetch JWT secret from Secrets Manager:", error);
      throw error;
    }
  }

  /**
   * Get a valid JWT token, refreshing if necessary
   */
  async getToken(): Promise<string> {
    // Ensure service is initialized
    if (!this.secret) {
      await this.initialize();
    }

    // Check if token needs refresh (< 5 minutes remaining)
    if (this.needsRefresh()) {
      this.generateToken();
    }

    if (!this.currentToken) {
      throw new Error("Failed to generate JWT token");
    }

    return this.currentToken;
  }

  /**
   * Check if current token needs refresh (< 5 minutes remaining)
   */
  private needsRefresh(): boolean {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = this.tokenExpiresAt - now;
    // Refresh if less than 5 minutes (300 seconds) remaining
    return timeUntilExpiry < 300;
  }

  /**
   * Generate a new JWT token with standard claims
   */
  private generateToken(): void {
    if (!this.secret) {
      throw new Error("JWT secret not initialized");
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.expiryHours * 3600; // Convert hours to seconds

    const payload: JWTPayload = {
      iss: "ask-archil-io",
      sub: "app",
      iat: now,
      exp: now + expiresIn,
    };

    try {
      this.currentToken = jwt.sign(payload, this.secret, {
        algorithm: "HS256",
      });
      this.tokenExpiresAt = payload.exp;
    } catch (error) {
      console.error("Failed to generate JWT token:", error);
      throw new Error("Failed to generate JWT token");
    }
  }

  /**
   * Get token expiry information
   */
  getTokenExpiry(): { expiresIn: number; expiresAt: number } {
    const now = Math.floor(Date.now() / 1000);
    return {
      expiresIn: this.tokenExpiresAt - now,
      expiresAt: this.tokenExpiresAt,
    };
  }
}

// Global singleton instance
let jwtServiceInstance: JWTService | null = null;

/**
 * Get or create the JWT service instance
 */
export async function getJWTService(): Promise<JWTService> {
  const secretArn = process.env.JWT_SECRET_ARN;
  if (!secretArn) {
    throw new Error("JWT_SECRET_ARN environment variable is not set");
  }

  if (!jwtServiceInstance) {
    const expiryHours = parseInt(process.env.JWT_EXPIRY_HOURS || "1", 10);
    jwtServiceInstance = new JWTService(secretArn, expiryHours);
    await jwtServiceInstance.initialize();
  }

  return jwtServiceInstance;
}

/**
 * Export JWTService class for testing
 */
export { JWTService };
