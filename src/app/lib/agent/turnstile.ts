interface TurnstileValidationRequest {
  secret: string;
  response: string;
  remoteip?: string;
}

interface TurnstileValidationResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
  cacheKey?: string;
}

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function validateTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<{ valid: boolean; error?: string }> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    console.error("TURNSTILE_SECRET_KEY not configured");
    return {
      valid: false,
      error: "CAPTCHA validation not configured",
    };
  }

  if (!token) {
    return {
      valid: false,
      error: "No CAPTCHA token provided",
    };
  }

  try {
    const body: TurnstileValidationRequest = {
      secret: secretKey,
      response: token,
    };

    if (remoteIp) {
      body.remoteip = remoteIp;
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return {
        valid: false,
        error: `Cloudflare API error: ${response.statusText}`,
      };
    }

    const data: TurnstileValidationResponse = await response.json();

    if (data.success) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Validation failed: ${data["error-codes"]?.join(", ") || "unknown error"}`,
    };
  } catch (error) {
    console.error("Turnstile validation error:", error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function extractClientIp(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  // Try to get IP from CloudFlare header first
  const cfIP = headers["cf-connecting-ip"];
  if (cfIP) {
    return typeof cfIP === "string" ? cfIP : cfIP[0];
  }

  // Try x-forwarded-for (for proxies)
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    const ip = typeof forwarded === "string" ? forwarded : forwarded[0];
    return ip.split(",")[0].trim();
  }

  return undefined;
}
