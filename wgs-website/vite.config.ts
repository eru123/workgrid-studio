import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { AppRoutesSSG } from "./src/AppRoutesSSG";
import { PAGE_META, injectPageMeta } from "./src/seo";

/**
 * Routes that can be fully pre-rendered (no Vite-specific ?raw imports).
 * MemoryRouter renders <Link> as proper <a href="..."> anchors for SEO.
 */
const SSG_FULL_RENDER = new Set(["/", "/docs", "/docs/ssh-docker-setup", "/about", "/contact"]);

/**
 * HTML shell with hashed asset paths captured during transformIndexHtml.
 * Still contains __PAGE_TITLE__ / __PAGE_* tokens so it can be reused per route.
 */
let htmlShell = "";

function renderRoute(location: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [location] },
      createElement(AppRoutesSSG),
    ),
  );
}

export default defineConfig({
  plugins: [
    react(),

    // ── Multi-route Static Site Generation ─────────────────────────────
    {
      name: "wgs-multipage-ssg",
      apply: "build",

      /**
       * Post-phase: runs after Vite injects hashed <script>/<link> tags.
       * We capture the shell (still has __PAGE_* tokens) and return the
       * fully pre-rendered homepage.
       */
      transformIndexHtml: {
        enforce: "post",
        handler(html) {
          htmlShell = html; // shell retains __PAGE_* tokens + correct asset URLs

          const content = renderRoute("/");
          const withContent = html.replace(
            '<div id="root"></div>',
            `<div id="root">${content}</div>`,
          );
          return injectPageMeta(withContent, PAGE_META["/"]);
        },
      },

      /**
       * After Vite writes dist/, generate one HTML file per additional route:
       * - Routes in SSG_FULL_RENDER  → pre-rendered component tree + meta
       * - Other routes (Changelog, Downloads) → correct meta, empty root
       *   (React SPA handles rendering; Google crawls JS, social cards read meta)
       */
      async closeBundle() {
        if (!htmlShell) return;

        const outDir = path.resolve(__dirname, "dist");

        for (const [route, meta] of Object.entries(PAGE_META)) {
          if (route === "/") continue;

          let pageHtml: string;
          if (SSG_FULL_RENDER.has(route)) {
            const content = renderRoute(route);
            pageHtml = htmlShell.replace(
              '<div id="root"></div>',
              `<div id="root">${content}</div>`,
            );
          } else {
            pageHtml = htmlShell; // meta-only; SPA renders content client-side
          }

          const finalHtml = injectPageMeta(pageHtml, meta);
          const segments = route.split("/").filter(Boolean);
          const filePath = join(outDir, ...segments, "index.html");
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, finalHtml, "utf-8");
        }
      },
    },
  ],

  server: {
    fs: {
      allow: [path.resolve(__dirname, ".."), __dirname],
    },
  },
});
