import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [reactRouter(), tailwindcss(), tsconfigPaths()],
  define: {
    "import.meta.env.TURNSTILE_SITE_KEY": JSON.stringify(
      process.env.TURNSTILE_SITE_KEY || "",
    ),
  },
});
