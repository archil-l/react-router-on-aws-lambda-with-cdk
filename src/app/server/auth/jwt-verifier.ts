import jwt from "jsonwebtoken";

interface JWTPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

interface VerificationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
}

/**
 * Extract JWT token from Authorization header
 * Expects format: "Authorization: Bearer {token}"
 */
export function extractTokenFromHeader(
  headers: Record<string, string | string[]>,
): string | null {
  const authHeader = headers.authorization;
  if (!authHeader) {
    return null;
  }

  // Handle both string and string[] (from Lambda/Express)
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  const parts = headerValue.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Verify JWT token signature and expiry
 */
export function verifyToken(token: string, secret: string): VerificationResult {
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
    }) as JWTPayload;

    return {
      valid: true,
      payload,
    };
  } catch (error) {
    let errorMessage = "Token verification failed";

    if (error instanceof jwt.TokenExpiredError) {
      errorMessage = "Token has expired";
    } else if (error instanceof jwt.JsonWebTokenError) {
      errorMessage = `Invalid token: ${error.message}`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return {
      valid: false,
      error: errorMessage,
    };
  }
}

/**
 * Verify token from Authorization header
 * Returns verification result or null if no token found
 */
export function verifyAuthHeader(
  headers: Record<string, string | string[]>,
  secret: string,
): VerificationResult | null {
  const token = extractTokenFromHeader(headers);

  if (!token) {
    return null;
  }

  return verifyToken(token, secret);
}
