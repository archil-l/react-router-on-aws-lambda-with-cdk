import { useEffect, useState } from "react";
import z from "zod";
import { themeSchema } from "~/lib/agent/tools/client-side-tools";

export type Theme = z.infer<typeof themeSchema>;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      setTheme(mediaQueryList.matches ? "dark" : "light");
    };

    mediaQueryList.addEventListener("change", handleChange);

    // Set the initial color scheme based on the current preference
    handleChange();

    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    console.log(`[useTheme] Toggling theme from ${theme} to ${newTheme}`);
    setTheme(newTheme);
  };

  return { theme, toggleTheme };
}
