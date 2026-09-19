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
const CANONICAL_DOCS_URL = "https://genesis.pixelzx.com/docs";
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

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s+/gu, "-") || "section"
  );
}

// GitHub-style heading ids so cross-page `#anchor` links resolve; h2/h3 feed the page TOC.
md.core.ruler.push("heading_ids", (state) => {
  const used = (state.env.headingIds ??= new Map());
  const headings = (state.env.headings ??= []);
  state.tokens.forEach((token, index) => {
    if (token.type !== "heading_open") {
      return;
    }
    const inline = state.tokens[index + 1];
    const text = (inline.children || [])
      .filter((child) => child.type === "text" || child.type === "code_inline")
      .map((child) => child.content)
      .join("")
      .trim();
    const base = slugify(text);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    token.attrSet("id", id);
    if (token.tag === "h2" || token.tag === "h3") {
      headings.push({ level: token.tag, id, text });
    }
  });
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

const CALLOUT_CLASSES = {
  Note: "note",
  Tip: "tip",
  Warning: "warning",
  Info: "note",
  Check: "tip",
};

// MDX container bodies are indented; strip that indent so markdown-it does not see code blocks.
// Fenced blocks are sliced by their own fence column, so fences the formatter left at a different
// column than the surrounding text keep their contents intact.
function dedent(value) {
  const lines = value.replace(/^[ \t]*\n+|\s+$/gu, "").split("\n");
  const indentOf = (line) => line.match(/^\s*/u)[0].length;
  let fence = null;
  const fenceColumns = lines.map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      const column = fence.column;
      if (marker && marker[0] === fence.marker[0] && marker.length >= fence.marker.length) {
        fence = null;
      }
      return column;
    }
    if (marker) {
      fence = { column: indentOf(line), marker };
      return fence.column;
    }
    return null;
  });
  // Text on the tag's own line (`<Tip>Heads up`) has no indent; measure the rest.
  const skipFirst = !/^[ \t]*\n/u.test(value);
  const textIndents = lines
    .map((line, index) =>
      line.trim() && fenceColumns[index] === null && !(skipFirst && index === 0)
        ? indentOf(line)
        : null,
    )
    .filter((indent) => indent !== null);
  const fenceIndents = fenceColumns.filter((column) => column !== null);
  const indent = Math.min(...(textIndents.length ? textIndents : fenceIndents), Infinity);
  // A fence 4+ columns deeper than the text is still a fence in MDX, not indented code.
  const fenceSlice = (column) => (column - indent >= 4 ? column : Math.min(indent, column));
  return lines
    .map((line, index) => {
      const column = fenceColumns[index];
      return line.slice(Math.min(indentOf(line), column === null ? indent : fenceSlice(column)));
    })
    .join("\n");
}

// Replaces `<Tag ...>body</Tag>` with dedented markdown, re-indented to the tag's own column so
// nested blocks (Tab > Steps > Step) keep relative structure instead of becoming indented code.
function replaceBlock(text, tag, render) {
  // Body may not open the same tag, so nested blocks (Tab > Tab) resolve innermost-first.
  const pattern = new RegExp(
    `^([ \\t]*)<${tag}(\\s[^>]*)?>((?:(?!<${tag}[\\s>])[\\s\\S])*?)<\\/${tag}>`,
    "gmu",
  );
  return text.replace(pattern, (_match, indent, attributes = "", body) =>
    render(attributes, dedent(body))
      .split("\n")
      .map((line) => (line ? indent + line : line))
      .join("\n"),
  );
}

function fieldHeading(attributes, primary, fallback) {
  const field =
    getTagAttribute(attributes, primary) || getTagAttribute(attributes, fallback) || "Field";
  const type = getTagAttribute(attributes, "type");
  return `#### ${field}${type ? ` (${type})` : ""}`;
}

const WRAPPER_TAGS = [
  "Steps",
  "Tabs",
  "AccordionGroup",
  "Columns",
  "CardGroup",
  "CodeGroup",
  "Frame",
];

// Each container becomes flush markdown at its own tag column. Wrappers are unwrapped the same way
// (not just deleted) so their children lose the extra nesting indent instead of turning into code.
const BLOCK_RENDERERS = [
  ...WRAPPER_TAGS.map((tag) => [tag, (_attributes, body) => `\n${body}\n`]),
  ...["Step", "Accordion", "Tab"].map((tag) => [
    tag,
    (attributes, body) => `\n### ${getTagAttribute(attributes, "title") || tag}\n\n${body}\n`,
  ]),
  [
    "ParamField",
    (attributes, body) => `\n${fieldHeading(attributes, "path", "name")}\n\n${body}\n`,
  ],
  [
    "ResponseField",
    (attributes, body) => `\n${fieldHeading(attributes, "name", "path")}\n\n${body}\n`,
  ],
  ...Object.entries(CALLOUT_CLASSES).map(([tag, className]) => [
    tag,
    (_attributes, body) => `\n<div class="callout ${className}">\n\n${body}\n\n</div>\n`,
  ]),
];

function simplifyMintlifyMdx(source) {
  let text = source;

  text = text.replace(/<Card\s+([^>]*)>([\s\S]*?)<\/Card>/gu, (_match, attributes, body) => {
    const title = getTagAttribute(attributes, "title") || "Open";
    const href = getTagAttribute(attributes, "href") || "#";
    return markdownListItem(title, href, body);
  });
  let previous;
  do {
    previous = text;
    for (const [tag, render] of BLOCK_RENDERERS) {
      text = replaceBlock(text, tag, render);
    }
  } while (text !== previous);
  // Leftovers that were not on their own line.
  text = text.replace(
    new RegExp(
      `<\\/?(?:${WRAPPER_TAGS.join("|")}|Step|Accordion|Tab|ParamField|ResponseField)\\b[^>]*>`,
      "gu",
    ),
    "\n",
  );
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

function renderMarkdown(page, routeAliases, env = {}) {
  const simplified = simplifyMintlifyMdx(page.body);
  let html = md.render(simplified, env);
  if (!/<h1[\s>]/u.test(html)) {
    html = `<h1>${escapeHtml(page.title)}</h1>\n${html}`;
  }
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
    const isCurrentTab = collectPagesFromNode(tab.groups || []).includes(currentRoute);
    parts.push(
      `<details class="nav-tab"${isCurrentTab ? " open" : ""}><summary>${escapeHtml(tab.tab || "Docs")}</summary>`,
    );
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
    parts.push("</details>");
  }
  return parts.join("\n");
}

function renderToc(headings) {
  if (headings.length < 2) {
    return "";
  }
  const items = headings
    .map(
      (heading) =>
        `<li class="toc-${heading.level}"><a href="#${escapeAttribute(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
    )
    .join("\n");
  return `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${items}</ul></nav>`;
}

function renderDocPage(page, navEntries, pagesByRoute, routeAliases) {
  const env = {};
  const body = renderMarkdown(page, routeAliases, env);
  const index = navEntries.findIndex((entry) => entry.route === page.route);
  const entry = navEntries[index];
  const crumbs = entry
    ? `<p class="crumbs">${escapeHtml(entry.tab)}${entry.group ? ` <span>/</span> ${escapeHtml(entry.group)}` : ""}</p>`
    : "";
  const pager = [
    [navEntries[index - 1], "prev", "Previous"],
    [navEntries[index + 1], "next", "Next"],
  ]
    .filter(([target]) => index >= 0 && target)
    .map(([target, className, label]) => {
      const title = pagesByRoute.get(target.route)?.title || humanizeRoute(target.route);
      return `<a class="pager-${className}" href="${escapeAttribute(relativeRoute(page.route, target.route))}"><span>${label}</span>${escapeHtml(title)}</a>`;
    })
    .join("");
  return `<div class="doc">
  <article class="prose">${crumbs}${body}${pager ? `<nav class="pager" aria-label="Pagination">${pager}</nav>` : ""}</article>
  ${renderToc(env.headings || [])}
</div>`;
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
    <h1>Run your AI agent <em>everywhere</em> you chat.</h1>
    <p class="lede">Install Genesis, connect chat channels, run the Gateway, and extend your agent with plugins — all on hardware you own.</p>
    <div class="hero-actions">
      <a class="button primary" href="${escapeAttribute(relativeRoute("index", "start/getting-started"))}">Get started →</a>
      <a class="button" href="${escapeAttribute(relativeRoute("index", "start/hubs"))}">Browse all docs</a>
      <a class="button" href="${REPO_URL}">GitHub</a>
    </div>
  </div>
  <div class="hero-panel">
    <div class="hero-panel-head"><span></span><span></span><span></span><em>quick start</em></div>
<pre><code><span class="c"># Node 24 recommended (22.14+ works)</span>
<span class="p">$</span> npm install -g @pixelzx/genesis@latest
<span class="p">$</span> genesis onboard --install-daemon
<span class="p">$</span> genesis dashboard</code></pre>
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

  const assetPrefix = rootRelativePrefix(currentRoute);
  const logoHref = escapeAttribute(rewriteAssetUrl("/assets/pixel-lobster.svg", currentRoute));

  return `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttribute(description)}" />
    <link rel="icon" href="${logoHref}" />
    <link rel="canonical" href="${escapeAttribute(canonicalHref)}" />
    <script>try{const t=localStorage.getItem("genesis-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch{}</script>
    <link rel="preconnect" href="https://api.fontshare.com" />
    <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&amp;f[]=sentient@400i&amp;display=swap" />
    <link rel="stylesheet" href="${escapeAttribute(assetPrefix)}styles.css" />
    <script defer src="${escapeAttribute(assetPrefix)}site.js"></script>
  </head>
  <body>
    <a class="skip-link" href="#content">Skip to content</a>
    <header class="site-header">
      <button class="icon-btn menu-btn" type="button" aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <a class="brand" href="${homeHref}" aria-label="Genesis Docs home">
        <img src="${logoHref}" alt="" />
        <span>Genesis <em>Docs</em></span>
      </a>
      <nav class="top-nav" aria-label="External links">
        <a href="${escapeAttribute(assetPrefix)}../">Home</a>
        <a href="${REPO_URL}/releases">Releases</a>
        <a href="${REPO_URL}">GitHub</a>
      </nav>
      <button class="icon-btn theme-btn" type="button" aria-label="Toggle color theme">
        <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
    </header>
    <div class="shell">
      <aside class="sidebar" id="sidebar" aria-label="Docs navigation">
        ${sidebar}
      </aside>
      <main id="content" class="content">
        ${content}
        <footer class="page-footer">
          <a href="${escapeAttribute(sourceHref)}">Edit this page on GitHub</a>
          <a href="${escapeAttribute(relativeRoute(currentRoute, "docs-map"))}">Docs map</a>
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
  for (const file of ["styles.css", "site.js"]) {
    fs.copyFileSync(path.join(SCRIPT_DIR, "github-pages-docs", file), path.join(OUT_DIR, file));
  }
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
        : renderDocPage(page, navEntries, pagesByRoute, routeAliases);
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
