import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { App } from "./src/App";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "prerender-homepage",
      apply: "build",
      transformIndexHtml(html) {
        const appHtml = renderToStaticMarkup(createElement(App));

        return html.replace(
          '<div id="root"></div>',
          `<div id="root">${appHtml}</div>`,
        );
      },
    },
  ],
});
