#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import YAML from "yaml";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const DOCS_DIR = path.join(ROOT, "docs");
const OUT_DIR = path.resolve(
  ROOT,
  process.env.GENESIS_GITHUB_PAGES_OUT_DIR || ".artifacts/github-pages-docs",
);
const REPO_URL = "https://github.com/PIXELZX0/Genesis";
const CANONICAL_DOCS_URL = "https://docs.genesis.ai";
const EXCLUDED_DOC_DIRS = new Set([
  ".generated",
  ".i18n",
  "archive",
  "assets",
  "images",
  "research",
]);

const md = new MarkdownIt({
  html: true,
  linkify: true,
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function normalizeRoutePath(value) {
  return (
    String(value || "")
      .split("#")[0]
      .replace(/^\/+/u, "")
      .replace(/\/+$/u, "")
      .replace(/\.(mdx?|html)$/iu, "") || "index"
  );
}

function walkDocRoutes(dir = DOCS_DIR, base = DOCS_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || EXCLUDED_DOC_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDocRoutes(fullPath, base, out);
      continue;
    }

    if (!entry.isFile() || !/\.mdx?$/iu.test(entry.name) || entry.name === "AGENTS.md") {
      continue;
    }

    const relativePath = path.relative(base, fullPath).replaceAll(path.sep, "/");
    out.push(normalizeRoutePath(relativePath));
  }
  return out;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { data: {}, body: raw };
  }

  const lines = raw.split(/\r?\n/u);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---" || lines[index] === "...") {
      const text = lines.slice(1, index).join("\n");
      const body = lines.slice(index + 1).join("\n");
      try {
        return { data: YAML.parse(text) || {}, body };
      } catch {
        return { data: {}, body };
      }
    }
  }
  return { data: {}, body: raw };
}

function humanizeRoute(route) {
  const leaf = route.split("/").at(-1) || "index";
  return leaf
    .replace(/-/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase())
    .replace(/\bCli\b/gu, "CLI")
    .replace(/\bUi\b/gu, "UI")
    .replace(/\bIos\b/gu, "iOS");
}

function findDocPath(route) {
  const candidates = [
    path.join(DOCS_DIR, `${route}.md`),
    path.join(DOCS_DIR, `${route}.mdx`),
    path.join(DOCS_DIR, route, "index.md"),
    path.join(DOCS_DIR, route, "index.mdx"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function pageOutputPath(route) {
  if (route === "index") {
    return path.join(OUT_DIR, "index.html");
  }
  const routeDir = route.endsWith("/index") ? route.slice(0, -"/index".length) : route;
  return path.join(OUT_DIR, routeDir, "index.html");
}

function routeToPathname(route) {
  if (route === "index") {
    return "/";
  }
  const routeDir = route.endsWith("/index") ? route.slice(0, -"/index".length) : route;
  return `/${routeDir}/`;
}

function relativeRoute(fromRoute, toRoute) {
  const fromFile = pageOutputPath(fromRoute);
  const toFile = pageOutputPath(toRoute);
  let relative = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, "/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}

function collectPagesFromNode(node, out = []) {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectPagesFromNode(item, out);
    }
    return out;
  }
  if (node && typeof node === "object") {
    collectPagesFromNode(node.pages, out);
  }
  return out;
}

function collectNavTree(config) {
  const language = config.navigation?.languages?.find((entry) => entry.language === "en");
  if (!language) {
    throw new Error("docs/docs.json is missing navigation.languages entry for en");
  }
  return language.tabs || [];
}

function flattenNav(tabs) {
  const pages = [];
  for (const tab of tabs) {
    for (const group of tab.groups || []) {
      for (const route of collectPagesFromNode(group.pages || [])) {
        pages.push({
          route,
          tab: tab.tab || "Docs",
          group: group.group || "",
        });
      }
    }
  }
  const seen = new Set();
  return pages.filter((page) => {
    if (seen.has(page.route)) {
      return false;
    }
    seen.add(page.route);
    return true;
  });
}

function readPage(route) {
  const sourcePath = findDocPath(route);
  if (!sourcePath) {
    return {
      route,
      title: humanizeRoute(route),
      summary: "",
      body: `# ${humanizeRoute(route)}\n\nThis page is listed in the docs navigation, but no source file was found.`,
      sourcePath: null,
    };
  }
  const raw = fs.readFileSync(sourcePath, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const heading = body.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  return {
    route,
    title: String(data.title || heading || humanizeRoute(route)),
    summary: typeof data.summary === "string" ? data.summary : "",
    body,
    sourcePath,
  };
}

function readPages(routes) {
  return new Map(routes.map((route) => [route, readPage(route)]));
}

function buildRouteAliases(routes, redirects = []) {
  const aliases = new Map();
  for (const route of routes) {
    aliases.set(route, route);
    if (route === "index") {
      aliases.set("", route);
      continue;
    }
    if (route.endsWith("/index")) {
      aliases.set(route.slice(0, -"/index".length), route);
    }
  }
  for (const redirect of redirects) {
    const source = normalizeRoutePath(redirect.source);
    const destination = normalizeRoutePath(redirect.destination);
    const target = aliases.get(destination) || destination;
    if (aliases.has(target)) {
      aliases.set(source, target);
    }
  }
  return aliases;
}

function stripHtmlTags(value) {
  return String(value)
    .replace(/<[^>]*>/gu, "")
    .trim();
}

function getTagAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = attributes.match(new RegExp(`${escaped}\\s*=\\s*"([^"]*)"`, "u"));
  return match?.[1] || "";
}

function markdownListItem(title, href, body) {
  const cleanedBody = stripHtmlTags(body).replace(/\s+/gu, " ").trim();
  const suffix = cleanedBody ? `\n  ${cleanedBody}` : "";
  return `- [${title}](${href})${suffix}\n`;
}

function simplifyMintlifyMdx(source) {
  let text = source;

  text = text.replace(/<Card\s+([^>]*)>([\s\S]*?)<\/Card>/gu, (_match, attributes, body) => {
    const title = getTagAttribute(attributes, "title") || "Open";
    const href = getTagAttribute(attributes, "href") || "#";
    return markdownListItem(title, href, body);
  });
  text = text.replace(/<\/?Columns[^>]*>/gu, "\n");
  text = text.replace(/<\/?CardGroup[^>]*>/gu, "\n");
  text = text.replace(/<\/?Steps[^>]*>/gu, "\n");
  text = text.replace(/<Step\s+([^>]*)>/gu, (_match, attributes) => {
    const title = getTagAttribute(attributes, "title") || "Step";
    return `\n### ${title}\n`;
  });
  text = text.replace(/<\/Step>/gu, "\n");
  text = text.replace(/<\/?AccordionGroup[^>]*>/gu, "\n");
  text = text.replace(/<Accordion\s+([^>]*)>/gu, (_match, attributes) => {
    const title = getTagAttribute(attributes, "title") || "Details";
    return `\n### ${title}\n`;
  });
  text = text.replace(/<\/Accordion>/gu, "\n");
  text = text.replace(/<\/?Tabs[^>]*>/gu, "\n");
  text = text.replace(/<Tab\s+([^>]*)>/gu, (_match, attributes) => {
    const title = getTagAttribute(attributes, "title") || "Tab";
    return `\n### ${title}\n`;
  });
  text = text.replace(/<\/Tab>/gu, "\n");
  text = text.replace(/<ParamField\s+([^>]*)>/gu, (_match, attributes) => {
    const field =
      getTagAttribute(attributes, "path") || getTagAttribute(attributes, "name") || "Field";
    const type = getTagAttribute(attributes, "type");
    return `\n#### ${field}${type ? ` (${type})` : ""}\n`;
  });
  text = text.replace(/<\/ParamField>/gu, "\n");
  text = text.replace(/<ResponseField\s+([^>]*)>/gu, (_match, attributes) => {
    const field =
      getTagAttribute(attributes, "name") || getTagAttribute(attributes, "path") || "Field";
    const type = getTagAttribute(attributes, "type");
    return `\n#### ${field}${type ? ` (${type})` : ""}\n`;
  });
  text = text.replace(/<\/ResponseField>/gu, "\n");
  text = text.replace(/<Note>/gu, '<div class="callout note">');
  text = text.replace(/<\/Note>/gu, "</div>");
  text = text.replace(/<Tip>/gu, '<div class="callout tip">');
  text = text.replace(/<\/Tip>/gu, "</div>");
  text = text.replace(/<Warning>/gu, '<div class="callout warning">');
  text = text.replace(/<\/Warning>/gu, "</div>");
  text = text.replace(/<Info>/gu, '<div class="callout note">');
  text = text.replace(/<\/Info>/gu, "</div>");
  text = text.replace(/<Check>/gu, '<div class="callout tip">');
  text = text.replace(/<\/Check>/gu, "</div>");
  text = text.replace(/<\/?Frame[^>]*>/gu, "\n");
  text = text.replace(/<\/?CodeGroup[^>]*>/gu, "\n");
  text = text.replace(/<Redirect\s+([^>]*)\/?>/gu, (_match, attributes) => {
    const target = getTagAttribute(attributes, "to") || getTagAttribute(attributes, "href") || "/";
    return `This page has moved to [${target}](${target}).`;
  });
  return text;
}

function rootRelativePrefix(route) {
  return relativeRoute(route, "index").replace(/index\.html$/u, "");
}

function rewriteAssetUrl(url, route) {
  if (url.startsWith("/assets/") || url.startsWith("/images/")) {
    return rootRelativePrefix(route) + url.slice(1);
  }
  if (url === "/whatsapp-genesis.jpg" || url === "/whatsapp-genesis-ai-zh.jpg") {
    return rootRelativePrefix(route) + url.slice(1);
  }
  return url;
}

function rewriteDocUrl(url, route, routeAliases) {
  if (!url.startsWith("/")) {
    return url;
  }
  if (
    url.startsWith("//") ||
    url.startsWith("/assets/") ||
    url.startsWith("/images/") ||
    url === "/whatsapp-genesis.jpg" ||
    url === "/whatsapp-genesis-ai-zh.jpg"
  ) {
    return rewriteAssetUrl(url, route);
  }

  const [pathPart, hashPart = ""] = url.slice(1).split("#");
  const normalized = pathPart.replace(/\/$/u, "") || "index";
  const targetRoute = routeAliases.get(normalized);
  if (!targetRoute) {
    return url;
  }
  return `${relativeRoute(route, targetRoute)}${hashPart ? `#${hashPart}` : ""}`;
}

function renderMarkdown(page, routeAliases) {
  const simplified = simplifyMintlifyMdx(page.body);
  let html = md.render(simplified);
  html = html.replace(/href="([^"]+)"/gu, (_match, href) => {
    return `href="${escapeAttribute(rewriteDocUrl(href, page.route, routeAliases))}"`;
  });
  html = html.replace(/src="([^"]+)"/gu, (_match, src) => {
    return `src="${escapeAttribute(rewriteAssetUrl(src, page.route))}"`;
  });
  return html;
}

function renderSidebar(tabs, pagesByRoute, currentRoute) {
  const parts = [];
  for (const tab of tabs) {
    parts.push(`<section class="nav-tab"><h2>${escapeHtml(tab.tab || "Docs")}</h2>`);
    for (const group of tab.groups || []) {
      const routes = collectPagesFromNode(group.pages || []);
      if (routes.length === 0) {
        continue;
      }
      parts.push(`<div class="nav-group"><h3>${escapeHtml(group.group || "Pages")}</h3><ul>`);
      for (const route of routes) {
        const page = pagesByRoute.get(route);
        const active = route === currentRoute ? ' aria-current="page" class="active"' : "";
        const label = page?.title || humanizeRoute(route);
        parts.push(
          `<li><a${active} href="${escapeAttribute(relativeRoute(currentRoute, route))}">${escapeHtml(label)}</a></li>`,
        );
      }
      parts.push("</ul></div>");
    }
    parts.push("</section>");
  }
  return parts.join("\n");
}

function renderCards(route, pages, label) {
  return pages
    .map((page) => {
      const href = relativeRoute(route, page.route);
      const summary = page.summary || `${label} documentation.`;
      return `<a class="card" href="${escapeAttribute(href)}">
  <span class="card-label">${escapeHtml(label)}</span>
  <strong>${escapeHtml(page.title)}</strong>
  <span>${escapeHtml(summary)}</span>
</a>`;
    })
    .join("\n");
}

function renderHome(page, tabs, pagesByRoute, redirects) {
  const routeAliases = buildRouteAliases(pagesByRoute.keys(), redirects);
  const quickRoutes = [
    "start/getting-started",
    "start/wizard",
    "install/index",
    "channels/index",
    "web/control-ui",
    "gateway/configuration",
  ];
  const quickPages = quickRoutes.map((route) => pagesByRoute.get(route)).filter(Boolean);
  const tabCards = tabs
    .map((tab) => {
      const route = collectPagesFromNode(tab.groups || []).find((candidate) =>
        pagesByRoute.has(candidate),
      );
      const target = route ? pagesByRoute.get(route) : null;
      if (!target) {
        return "";
      }
      return `<a class="card compact" href="${escapeAttribute(relativeRoute("index", target.route))}">
  <strong>${escapeHtml(tab.tab || target.title)}</strong>
  <span>${escapeHtml(target.summary || target.title)}</span>
</a>`;
    })
    .filter(Boolean)
    .join("\n");

  return `
<section class="hero">
  <div>
    <p class="eyebrow">Genesis documentation</p>
    <h1>Self-hosted gateway docs for AI agents.</h1>
    <p class="lede">Install Genesis, connect chat channels, run the Gateway, and operate the agent surface from one GitHub Pages site.</p>
    <div class="hero-actions">
      <a class="button primary" href="${escapeAttribute(relativeRoute("index", "start/getting-started"))}">Get started</a>
      <a class="button" href="${escapeAttribute(relativeRoute("index", "start/hubs"))}">Browse all docs</a>
      <a class="button" href="${REPO_URL}">GitHub</a>
    </div>
  </div>
  <div class="hero-panel">
    <img src="assets/genesis-logo-text.svg" alt="Genesis" />
    <code>npm install -g @pixelzx/genesis@latest</code>
    <code>genesis onboard --install-daemon</code>
    <code>genesis dashboard</code>
  </div>
</section>
<section class="section">
  <div class="section-heading">
    <p class="eyebrow">Start here</p>
    <h2>Common paths</h2>
  </div>
  <div class="grid">
    ${renderCards("index", quickPages, "Guide")}
  </div>
</section>
<section class="section">
  <div class="section-heading">
    <p class="eyebrow">Directory</p>
    <h2>Docs by area</h2>
  </div>
  <div class="grid">
    ${tabCards}
  </div>
</section>
<section class="section prose">
  ${renderMarkdown(page, routeAliases)}
</section>`;
}

function renderLayout({ page, currentRoute, tabs, pagesByRoute, content }) {
  const title = currentRoute === "index" ? "Genesis Docs" : `${page.title} - Genesis Docs`;
  const description =
    page.summary ||
    "Genesis documentation for installation, channels, Gateway operation, plugins, and agents.";
  const sidebar = renderSidebar(tabs, pagesByRoute, currentRoute);
  const homeHref = escapeAttribute(relativeRoute(currentRoute, "index"));
  const sourceHref = page.sourcePath
    ? `${REPO_URL}/blob/main/${path.relative(ROOT, page.sourcePath).replaceAll(path.sep, "/")}`
    : REPO_URL;
  const canonicalHref =
    currentRoute === "index"
      ? CANONICAL_DOCS_URL
      : `${CANONICAL_DOCS_URL}${routeToPathname(currentRoute)}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttribute(description)}" />
    <link rel="icon" href="${escapeAttribute(rewriteAssetUrl("/assets/pixel-lobster.svg", currentRoute))}" />
    <link rel="canonical" href="${escapeAttribute(canonicalHref)}" />
    <link rel="stylesheet" href="${escapeAttribute(relativeRoute(currentRoute, "index").replace(/index\.html$/u, "styles.css"))}" />
  </head>
  <body>
    <a class="skip-link" href="#content">Skip to content</a>
    <header class="site-header">
      <a class="brand" href="${homeHref}" aria-label="Genesis Docs home">
        <img src="${escapeAttribute(rewriteAssetUrl("/assets/pixel-lobster.svg", currentRoute))}" alt="" />
        <span>Genesis Docs</span>
      </a>
      <nav class="top-nav" aria-label="External links">
        <a href="${CANONICAL_DOCS_URL}">Mintlify docs</a>
        <a href="${REPO_URL}">GitHub</a>
      </nav>
    </header>
    <div class="shell">
      <aside class="sidebar" aria-label="Docs navigation">
        ${sidebar}
      </aside>
      <main id="content" class="content">
        ${content}
        <footer class="page-footer">
          <a href="${escapeAttribute(sourceHref)}">Edit source on GitHub</a>
          <a href="${escapeAttribute(canonicalHref)}">Open canonical docs</a>
        </footer>
      </main>
    </div>
  </body>
</html>
`;
}

function writePage(route, html) {
  const target = pageOutputPath(route);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
}

function renderDocsMap(tabs, pagesByRoute) {
  const page = {
    route: "docs-map",
    title: "Docs map",
    summary: "Complete Genesis docs navigation map for GitHub Pages.",
    sourcePath: null,
  };
  const content = `
<article class="prose">
  <h1>Docs map</h1>
  <p>Every generated GitHub Pages route from <code>docs/docs.json</code>.</p>
  ${tabs
    .map(
      (tab) => `<h2>${escapeHtml(tab.tab || "Docs")}</h2>
${(tab.groups || [])
  .map((group) => {
    const routes = collectPagesFromNode(group.pages || []);
    return `<h3>${escapeHtml(group.group || "Pages")}</h3>
<ul>
${routes
  .map((route) => {
    const navPage = pagesByRoute.get(route);
    const label = navPage?.title || humanizeRoute(route);
    return `<li><a href="${escapeAttribute(relativeRoute("docs-map", route))}">${escapeHtml(label)}</a></li>`;
  })
  .join("\n")}
</ul>`;
  })
  .join("\n")}`,
    )
    .join("\n")}
</article>`;
  return renderLayout({
    page,
    currentRoute: "docs-map",
    tabs,
    pagesByRoute,
    content,
  });
}

function writeStyles() {
  const css = `
:root {
  color-scheme: light;
  --bg: #fbfaf7;
  --surface: #ffffff;
  --surface-strong: #f2eee7;
  --text: #201e1b;
  --muted: #625d55;
  --border: #ddd5ca;
  --accent: #ff5a36;
  --accent-dark: #c83d22;
  --code-bg: #f3eee6;
  --shadow: 0 16px 45px rgba(49, 40, 32, 0.09);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.6;
}

a {
  color: var(--accent-dark);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.skip-link {
  left: 1rem;
  position: absolute;
  top: -4rem;
}

.skip-link:focus {
  top: 1rem;
}

.site-header {
  align-items: center;
  background: rgba(251, 250, 247, 0.94);
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 1rem;
  height: 64px;
  justify-content: space-between;
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: 20;
}

.brand,
.top-nav {
  align-items: center;
  display: flex;
  gap: 12px;
}

.brand {
  color: var(--text);
  font-weight: 800;
}

.brand img {
  height: 32px;
  width: 32px;
}

.top-nav {
  font-size: 0.92rem;
}

.shell {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  min-height: calc(100vh - 64px);
}

.sidebar {
  border-right: 1px solid var(--border);
  max-height: calc(100vh - 64px);
  overflow: auto;
  padding: 22px;
  position: sticky;
  top: 64px;
}

.nav-tab {
  margin-bottom: 24px;
}

.nav-tab h2 {
  color: var(--text);
  font-size: 0.86rem;
  letter-spacing: 0;
  margin: 0 0 10px;
  text-transform: uppercase;
}

.nav-group h3 {
  color: var(--muted);
  font-size: 0.86rem;
  font-weight: 700;
  margin: 16px 0 6px;
}

.nav-group ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-group a {
  border-radius: 6px;
  color: var(--muted);
  display: block;
  font-size: 0.92rem;
  padding: 5px 8px;
}

.nav-group a.active {
  background: var(--surface-strong);
  color: var(--text);
  font-weight: 700;
}

.content {
  min-width: 0;
  padding: 36px clamp(18px, 4vw, 58px);
}

.hero {
  align-items: stretch;
  display: grid;
  gap: 24px;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
  margin: 0 auto 48px;
  max-width: 1160px;
}

.hero h1 {
  font-size: clamp(2.45rem, 5vw, 5.2rem);
  letter-spacing: 0;
  line-height: 0.96;
  margin: 0 0 18px;
}

.lede {
  color: var(--muted);
  font-size: 1.14rem;
  max-width: 760px;
}

.eyebrow,
.card-label {
  color: var(--accent-dark);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
  margin: 0 0 10px;
  text-transform: uppercase;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
}

.button {
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text);
  display: inline-flex;
  font-weight: 750;
  min-height: 42px;
  padding: 9px 14px;
}

.button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}

.hero-panel,
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.hero-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
  padding: 24px;
}

.hero-panel img {
  display: block;
  height: auto;
  margin-bottom: 10px;
  max-width: 100%;
}

code,
pre {
  background: var(--code-bg);
  border-radius: 6px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

code {
  padding: 0.15em 0.35em;
}

pre {
  overflow: auto;
  padding: 16px;
}

pre code {
  background: transparent;
  padding: 0;
}

.section {
  margin: 0 auto 42px;
  max-width: 1160px;
}

.section-heading h2 {
  font-size: 2rem;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0 0 18px;
}

.grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.card {
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 150px;
  padding: 18px;
}

.card.compact {
  min-height: 126px;
}

.card span:last-child {
  color: var(--muted);
}

.prose {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  margin: 0 auto;
  max-width: 930px;
  padding: clamp(20px, 4vw, 42px);
}

.prose h1 {
  font-size: clamp(2rem, 4vw, 3.2rem);
  line-height: 1.05;
  margin-top: 0;
}

.prose h2 {
  border-top: 1px solid var(--border);
  margin-top: 2.2rem;
  padding-top: 1.4rem;
}

.prose img {
  height: auto;
  max-width: 100%;
}

.prose table {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
  width: 100%;
}

.prose th,
.prose td {
  border: 1px solid var(--border);
  padding: 8px 10px;
}

.callout {
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: 8px;
  margin: 18px 0;
  padding: 14px 16px;
}

.callout.warning {
  border-left-color: #b42318;
}

.page-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
  margin: 36px auto 0;
  max-width: 930px;
}

@media (max-width: 920px) {
  .shell,
  .hero {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-bottom: 1px solid var(--border);
    border-right: 0;
    max-height: 320px;
    position: static;
  }

  .top-nav {
    display: none;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #14110f;
    --surface: #1f1a17;
    --surface-strong: #2a231f;
    --text: #fff8f2;
    --muted: #c9baae;
    --border: #40362f;
    --accent: #ff6a42;
    --accent-dark: #ff987c;
    --code-bg: #2b241f;
    --shadow: 0 18px 46px rgba(0, 0, 0, 0.22);
  }
}
`;
  fs.writeFileSync(path.join(OUT_DIR, "styles.css"), css.trimStart());
}

function writeRobotsAndSitemap(routes) {
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "");
  fs.writeFileSync(path.join(OUT_DIR, "robots.txt"), "User-agent: *\nAllow: /\n");
  const urls = routes
    .map((route) => {
      const loc =
        route === "index" ? CANONICAL_DOCS_URL : `${CANONICAL_DOCS_URL}${routeToPathname(route)}`;
      return `  <url><loc>${escapeHtml(loc)}</loc></url>`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(OUT_DIR, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
}

function main() {
  const config = readJson(path.join(DOCS_DIR, "docs.json"));
  const tabs = collectNavTree(config);
  const navEntries = flattenNav(tabs);
  const routes = [
    ...new Set([
      "index",
      ...navEntries.map((entry) => entry.route),
      ...walkDocRoutes(),
      "docs-map",
    ]),
  ];
  const pagesByRoute = readPages(routes.filter((route) => route !== "docs-map"));

  cleanDir(OUT_DIR);
  copyDir(path.join(DOCS_DIR, "assets"), path.join(OUT_DIR, "assets"));
  copyDir(path.join(DOCS_DIR, "images"), path.join(OUT_DIR, "images"));
  for (const image of ["whatsapp-genesis.jpg", "whatsapp-genesis-ai-zh.jpg"]) {
    const source = path.join(DOCS_DIR, image);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(OUT_DIR, image));
    }
  }
  writeStyles();

  const routeAliases = buildRouteAliases(pagesByRoute.keys(), config.redirects || []);
  for (const page of pagesByRoute.values()) {
    const content =
      page.route === "index"
        ? renderHome(page, tabs, pagesByRoute, config.redirects || [])
        : `<article class="prose">${renderMarkdown(page, routeAliases)}</article>`;
    writePage(
      page.route,
      renderLayout({
        page,
        currentRoute: page.route,
        tabs,
        pagesByRoute,
        content,
      }),
    );
  }

  const docsMapHtml = renderDocsMap(tabs, pagesByRoute);
  writePage("docs-map", docsMapHtml);
  fs.copyFileSync(pageOutputPath("index"), path.join(OUT_DIR, "404.html"));
  writeRobotsAndSitemap(routes);

  console.log(`Generated GitHub Pages docs site at ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`Pages: ${routes.length}`);
}

main();
