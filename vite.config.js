
import react from '@vitejs/plugin-react'
import base44 from '@base44/vite-plugin'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(() => {
  // GitHub Pages serves from /<repo>/, so we set base accordingly during Actions builds.
  // This avoids a blank page if the URL is accessed without a trailing slash.
  const repo = process.env.GITHUB_REPOSITORY?.split('/')?.[1];
  const base = repo ? `/${repo}/` : '/';

  return {
    base,
  // Show the dev server URL in the terminal (Base44 exports sometimes set this to 'error').
  logLevel: 'info',
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true'
    }),
    react(),
  ]
  };
});
