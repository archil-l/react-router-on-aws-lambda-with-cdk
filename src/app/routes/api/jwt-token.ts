import { getJWTService } from "../../server/auth/jwt-service.js";

export async function loader() {
  try {
    const jwtService = await getJWTService();
    const token = await jwtService.getToken();
    const { expiresIn, expiresAt } = jwtService.getTokenExpiry();

    return new Response(
      JSON.stringify({
        token,
        expiresIn,
        expiresAt,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  } catch (error) {
    console.error("Failed to get JWT token:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to generate JWT token",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
