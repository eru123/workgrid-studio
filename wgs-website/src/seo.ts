export const BASE_URL = "https://workgrid-studio.skiddph.com";

export interface PageMeta {
  title: string;
  description: string;
  keywords: string;
  canonical: string;
}

export const PAGE_META: Record<string, PageMeta> = {
  "/": {
    title: "WorkGrid Studio — Lightweight Database Workbench",
    description:
      "A fast, under-10 MB desktop database workbench built with Rust and Tauri. VS Code-inspired UI. MySQL and MariaDB support, SSH tunneling, Docker container access, AI query generation, and schema browsing.",
    keywords:
      "database workbench, SQL editor, MySQL client, MariaDB client, SSH tunnel database, Docker MySQL, Tauri desktop app, Rust database tool, lightweight database GUI, open source database client",
    canonical: `${BASE_URL}/`,
  },
  "/docs": {
    title: "Documentation — WorkGrid Studio",
    description:
      "Complete documentation for WorkGrid Studio: connections, SSL/TLS, SSH tunneling, Docker support, SQL editor, schema browser, data export, CSV import, explain plans, AI query generation, and known limitations.",
    keywords:
      "WorkGrid Studio docs, database client documentation, SSH tunnel setup, MySQL connection guide, SQL editor docs",
    canonical: `${BASE_URL}/docs`,
  },
  "/docs/ssh-docker-setup": {
    title: "SSH + Docker Permission Setup — WorkGrid Studio",
    description:
      "Step-by-step guide to granting docker group permissions to an SSH user so WorkGrid Studio can run docker exec commands without sudo — required for Docker container tunneling.",
    keywords:
      "docker group permission, SSH docker exec, docker without sudo, usermod docker group, WorkGrid docker setup",
    canonical: `${BASE_URL}/docs/ssh-docker-setup`,
  },
  "/changelog": {
    title: "Changelog — WorkGrid Studio",
    description:
      "Full version history and release notes for WorkGrid Studio. Track every feature added, bug fixed, and improvement shipped.",
    keywords:
      "WorkGrid Studio changelog, release notes, version history, what's new",
    canonical: `${BASE_URL}/changelog`,
  },
  "/about": {
    title: "About — WorkGrid Studio",
    description:
      "WorkGrid Studio is built by Jericho Aquino (SKIDDPH), a senior full-stack engineer from Puerto Princesa, Palawan, Philippines. Built as the database tool we personally wanted to use every day.",
    keywords:
      "WorkGrid Studio about, SKIDDPH, Jericho Aquino, open source database tool, Tauri database workbench",
    canonical: `${BASE_URL}/about`,
  },
  "/contact": {
    title: "Contact — WorkGrid Studio",
    description:
      "Get in touch with the WorkGrid Studio team. Questions, bug reports, feature requests, or partnership inquiries — we're happy to hear from you.",
    keywords: "WorkGrid Studio contact, support, feedback, inquiries",
    canonical: `${BASE_URL}/contact`,
  },
  "/downloads": {
    title: "Download WorkGrid Studio — Free & Open Source",
    description:
      "Download WorkGrid Studio for Windows, macOS, and Linux. Free, open source, and under 10 MB. No account required. Available as NSIS, MSI, DMG, AppImage, and DEB.",
    keywords:
      "WorkGrid Studio download, database client download, Windows SQL client, macOS SQL client, Linux database tool, free database workbench",
    canonical: `${BASE_URL}/downloads`,
  },
  "/blog": {
    title: "Blog — WorkGrid Studio",
    description:
      "Articles, deep-dives, and technical guides from the WorkGrid Studio team. Product updates, tutorials, and developer stories.",
    keywords:
      "WorkGrid Studio blog, database workbench articles, SQL tutorials, developer guides, open source database",
    canonical: `${BASE_URL}/blog`,
  },
  "/blog/why-workgrid-studio": {
    title: "Why WorkGrid Studio? A Case Against Proprietary Lock-In — Blog",
    description:
      "Workbench is slow, HeidiSQL is Windows-only, TablePlus costs money. We built WorkGrid Studio as the free, open-source, VSCode-class database workbench that developers actually deserve.",
    keywords:
      "WorkGrid Studio vs MySQL Workbench, WorkGrid Studio vs HeidiSQL, WorkGrid Studio vs TablePlus, open source database client, free database GUI",
    canonical: `${BASE_URL}/blog/why-workgrid-studio`,
  },
};

/**
 * Replace __PAGE_TITLE__, __PAGE_DESCRIPTION__, __PAGE_KEYWORDS__,
 * and __PAGE_CANONICAL__ tokens in the HTML shell.
 */
export function injectPageMeta(html: string, meta: PageMeta): string {
  return html
    .split("__PAGE_TITLE__").join(escapeHtml(meta.title))
    .split("__PAGE_DESCRIPTION__").join(escapeHtml(meta.description))
    .split("__PAGE_KEYWORDS__").join(escapeHtml(meta.keywords))
    .split("__PAGE_CANONICAL__").join(meta.canonical);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
