import { build } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

async function runBuild() {
  console.log('--- 1. Building Extension UI & Background ---');
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
  }

  // 1. Build Popup and Background
  await build({
    configFile: resolve('vite.config.ts'),
  });

  console.log('--- 2. Building Self-Contained Content Script (IIFE) ---');
  // 2. Build Content script as a self-contained IIFE without module imports
  await build({
    configFile: false,
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve('src/extension/content.ts'),
        name: 'DOM_XContentScript',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
    },
  });

  console.log('--- 3. Building DOM_X MCP Server Bundle ---');
  // 3. Build Node-compatible MCP Server
  await build({
    configFile: false,
    publicDir: false,
    build: {
      outDir: 'dist/mcp',
      emptyOutDir: false,
      ssr: true,
      lib: {
        entry: resolve('src/mcp/index.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rollupOptions: {
        external: [
          'ws',
          'stream',
          'node:stream',
          'http',
          'https',
          'url',
          'events',
          'crypto',
          'node:crypto',
          '@modelcontextprotocol/sdk',
          /^@modelcontextprotocol\/sdk\/.*/,
        ],
      },
    },
  });

  const mcpDistPath = resolve('dist/mcp/index.js');
  if (fs.existsSync(mcpDistPath)) {
    let content = fs.readFileSync(mcpDistPath, 'utf8');
    if (!content.startsWith('#!/usr/bin/env node')) {
      content = '#!/usr/bin/env node\n' + content;
      fs.writeFileSync(mcpDistPath, content, 'utf8');
    }
  }

  // Verify manifest and output paths
  if (fs.existsSync('dist/src/extension/popup/index.html')) {
    fs.copyFileSync('dist/src/extension/popup/index.html', 'dist/popup.html');
  }

  console.log('--- Build complete! dist/ is ready for Chrome and dist/mcp/index.js is ready for MCP ---');
}

runBuild().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
