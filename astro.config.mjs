import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://shiplog.karanbalani.tech",
  integrations: [react()],
});
