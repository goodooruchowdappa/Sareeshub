// @ts-check
import { defineConfig, envField } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "http://localhost:4321",
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  integrations: [react()],
  trailingSlash: "never",
  devToolbar: { enabled: false },
  build: { inlineStylesheets: "auto", format: "file" },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  vite: {
    plugins: [tailwindcss()],
    build: { chunkSizeWarningLimit: 1200 },
  },
  env: {
    schema: {
      PUBLIC_SUPABASE_URL: envField.string({ context: "client", access: "public" }),
      PUBLIC_SUPABASE_ANON_KEY: envField.string({ context: "client", access: "public" }),
      PUBLIC_SITE_URL: envField.string({ context: "client", access: "public", default: "http://localhost:4321" }),
      PUBLIC_CONTACT_EMAIL: envField.string({ context: "client", access: "public", default: "support@example.com" }),
      PUBLIC_CONTACT_PHONE: envField.string({ context: "client", access: "public", default: "" }),
      PUBLIC_BUSINESS_NAME: envField.string({ context: "client", access: "public", default: "Sarees Hub" }),
      PUBLIC_BUSINESS_ADDRESS: envField.string({ context: "client", access: "public", default: "India" }),
      PUBLIC_MAP_STYLE: envField.string({
        context: "client",
        access: "public",
        default: "https://tiles.openfreemap.org/styles/liberty",
      }),
      PUBLIC_GEOCODER_URL: envField.string({ context: "client", access: "public", default: "https://photon.komoot.io" }),
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      RAZORPAY_KEY_ID: envField.string({ context: "server", access: "secret", optional: true }),
      RAZORPAY_KEY_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      RAZORPAY_WEBHOOK_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      RAZORPAY_API_BASE: envField.string({ context: "server", access: "public", default: "https://api.razorpay.com" }),
      // Optional e-mail alerts for custom requests (resend.com free tier: 3,000 mails/month).
      RESEND_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      EMAIL_FROM: envField.string({ context: "server", access: "public", default: "Sarees Hub <alerts@sareeshub.in>" }),
      RESEND_API_BASE: envField.string({ context: "server", access: "public", default: "https://api.resend.com" }),
    },
  },
});
