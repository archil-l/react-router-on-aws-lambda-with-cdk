import { useState, useEffect } from "react";

interface UseTokenResult {
  token: string | null;
  isTokenLoading: boolean;
}

export function useToken(): UseTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [isTokenLoading, setIsTokenLoading] = useState(true);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const response = await fetch("/api/jwt-token");
        if (!response.ok) {
          throw new Error("Failed to fetch JWT token");
        }
        const data = (await response.json()) as { token: string };
        setToken(data.token);
      } catch (error) {
        console.error("Failed to fetch JWT token:", error);
      } finally {
        setIsTokenLoading(false);
      }
    };

    fetchToken();
  }, []);

  return { token, isTokenLoading };
}
