import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface GuideDoc {
  file: string;
  slug: string;
  title: string;
  html: string;
  excerpt: string;
  sections: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const siteSrcDir = path.join(repoRoot, "site");
const outDir = path.join(repoRoot, "site-dist");
const docsDir = path.join(repoRoot, "docs");
const apiDocsDir = path.join(docsDir, "api");
const readmePath = path.join(repoRoot, "README.md");

const siteOrigin = (process.env.SITE_ORIGIN ?? "https://example.com").replace(/\/$/, "");
const basePathRaw = process.env.SITE_BASE_PATH ?? "/openhue-client";
const basePath = normalizeBasePath(basePathRaw);
const siteName = "OpenHue Client";
const siteTitle = `${siteName} — Hue automation with fun, modern docs`;
const siteDescription =
  "A trendy GitHub Pages hub for the OpenHue Client TypeScript SDK, CLI, MCP server, and Philips Hue how-to guides.";
const supportUrl = "https://buymeacottoncandy.com";
const siteUrl = `${siteOrigin}${basePath}`;
const navLinks = [
  { href: withBase('/#features'), label: 'Features' },
  { href: withBase('/#how-to-guides'), label: 'How-to guides' },
  { href: withBase('/#publishing'), label: 'Publishing' },
  { href: withBase('/api/'), label: 'API' },
  { href: supportUrl, label: 'Support' },
];

main();

function main(): void {
  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });

  copyStaticAssets();

  const docs = loadGuideDocs();
  const readme = loadReadme(readmePath);
  const highlights = extractHighlights(readme);
  const commands = extractCommands(readme);

  writeFileSync(path.join(outDir, "index.html"), renderIndexPage({ docs, highlights, commands }), "utf8");
  writeGuidePages(docs);
  writeSeoFiles(docs);

  if (existsSync(apiDocsDir)) {
    cpSync(apiDocsDir, path.join(outDir, "api"), { recursive: true });
  }
}

function copyStaticAssets(): void {
  if (existsSync(siteSrcDir)) {
    cpSync(siteSrcDir, outDir, { recursive: true });
  }
}

function loadGuideDocs(): GuideDoc[] {
  return readdirSync(docsDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => {
      const filePath = path.join(docsDir, entry);
      const markdown = readFileSync(filePath, "utf8");
      const slug = entry.replace(/\.md$/, "");
      const titleMatch = markdown.match(/^#\s+(.+)$/m);
      const title = titleMatch?.[1]?.trim() ?? slug;
      const excerpt = extractExcerpt(markdown);
      const sections = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => (match[1] ?? '').trim()).filter(Boolean);
      return {
        file: entry,
        slug,
        title,
        html: renderMarkdown(markdown),
        excerpt,
        sections,
      };
    });
}

function loadReadme(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function extractHighlights(markdown: string): string[] {
  const match = markdown.match(/## Highlights\n\n([\s\S]*?)\n## /);
  if (!match) return [];
  const [, body = ''] = match;
  return body
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function extractCommands(markdown: string): string[] {
  const match = markdown.match(/## Commands\n\nRun `npm run validate`[\s\S]*?```bash\n([\s\S]*?)```/);
  if (!match) return [];
  const [, body = ''] = match;
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractExcerpt(markdown: string): string {
  const lines = markdown.split("\n");
  const startIndex = lines.findIndex((line) => line.startsWith("# "));
  let inCodeBlock = false;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const candidate = lines[index]?.trim() ?? "";

    if (candidate.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock || !candidate || candidate.startsWith("#") || candidate.startsWith("- ") || /^\d+\./.test(candidate)) {
      continue;
    }

    return candidate;
  }

  return "";
}

function renderIndexPage(input: { docs: GuideDoc[]; highlights: string[]; commands: string[] }): string {
  const guideCards = input.docs
    .map(
      (doc) => `
        <article class="guide-card card reveal">
          <div class="guide-card__meta">
            <span class="pill">How-to guide</span>
            <span>${escapeHtml(doc.sections.slice(0, 3).join(" • "))}</span>
          </div>
          <h3><a href="${withBase(`/guides/${doc.slug}/`)}">${escapeHtml(doc.title)}</a></h3>
          <p>${escapeHtml(doc.excerpt)}</p>
          <a class="text-link" href="${withBase(`/guides/${doc.slug}/`)}">Read the guide →</a>
        </article>`,
    )
    .join("");

  const highlightCards = input.highlights
    .map(
      (item, index) => `
        <article class="feature card reveal">
          <span class="feature__number">0${index + 1}</span>
          <p>${escapeHtml(item)}</p>
        </article>`,
    )
    .join("");

  const commandItems = input.commands
    .map((command) => `<code>${escapeHtml(command)}</code>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    ${renderHead({
      title: siteTitle,
      description: siteDescription,
      pathName: "/",
      type: "website",
    })}
  </head>
  <body>
    <div class="page-shell">
      ${renderHeader()}
      <main>
        <section class="hero">
          <div class="hero__copy reveal">
            <span class="eyebrow">2026 design trend edition ✨</span>
            <h1>Fun, polished Hue docs for builders who want glow-up energy.</h1>
            <p>
              OpenHue Client is a TypeScript SDK, CLI, and MCP server for Philips Hue. This GitHub Pages experience
              remixes the repo docs into a vivid, searchable launchpad with dark mode, light mode, SEO, and social sharing baked in.
            </p>
            <div class="hero__actions">
              <a class="button button--primary" href="#how-to-guides">Explore guides</a>
              <a class="button button--secondary" href="${supportUrl}" target="_blank" rel="noreferrer">Support via Buy Me a Cotton Candy</a>
            </div>
            <ul class="hero__stats">
              <li><strong>${input.docs.length}</strong><span>Guides remixed from existing docs</span></li>
              <li><strong>Dark / Light</strong><span>Theme-aware, with a manual toggle</span></li>
              <li><strong>SEO + iMessage</strong><span>Open Graph, Twitter, robots, sitemap, and a social card</span></li>
            </ul>
          </div>
          <div class="hero__visual card reveal">
            <div class="orb orb--pink"></div>
            <div class="orb orb--blue"></div>
            <div class="stack">
              <div class="stack__panel stack__panel--top">
                <span class="pill">Repo vibe</span>
                <h2>SDK + CLI + MCP</h2>
                <p>Generated from <code>openhue.yaml</code>, wrapped by ergonomic helpers, documented for humans.</p>
              </div>
              <div class="stack__panel stack__panel--bottom">
                <span class="pill">Reuse-first docs</span>
                <p>The landing page and guide pages are generated from the repo’s existing Markdown docs, so updates stay aligned.</p>
              </div>
            </div>
          </div>
        </section>

        <section class="section section--split reveal" id="features">
          <div>
            <span class="eyebrow">What makes it special</span>
            <h2>Everything needed to ship local Hue automations with style.</h2>
          </div>
          <div class="feature-grid">
            ${highlightCards}
          </div>
        </section>

        <section class="section reveal" id="how-to-guides">
          <div class="section__heading">
            <div>
              <span class="eyebrow">How-to guides</span>
              <h2>Start here, then deep dive into the docs you need.</h2>
            </div>
            <a class="text-link" href="${withBase("/api/")}">Browse generated API reference →</a>
          </div>
          <div class="guide-grid">
            ${guideCards}
          </div>
        </section>

        <section class="section section--alt reveal" id="repo-usage">
          <div class="section__heading">
            <div>
              <span class="eyebrow">How to use the repo</span>
              <h2>Core commands for generating, validating, building, and exploring OpenHue Client.</h2>
            </div>
          </div>
          <div class="command-cloud card">
            ${commandItems}
          </div>
        </section>

        <section class="section reveal" id="publishing">
          <div class="section__heading">
            <div>
              <span class="eyebrow">Publishing workflow</span>
              <h2>Automated GitHub Pages deployment on every push to <code>main</code>.</h2>
            </div>
          </div>
          <div class="timeline">
            <article class="timeline__item card"><strong>1.</strong><p><code>npm ci</code> installs dependencies in GitHub Actions.</p></article>
            <article class="timeline__item card"><strong>2.</strong><p><code>npm run docs</code> refreshes the TypeDoc API reference under <code>docs/api</code>.</p></article>
            <article class="timeline__item card"><strong>3.</strong><p><code>npm run pages:build</code> generates this site from the repo Markdown docs and copies API docs into the deploy artifact.</p></article>
            <article class="timeline__item card"><strong>4.</strong><p><code>actions/deploy-pages</code> publishes the static output to GitHub Pages.</p></article>
          </div>
        </section>

        <section class="section section--support reveal" id="support">
          <div class="support card">
            <div>
              <span class="eyebrow">Support the project</span>
              <h2>If these docs sparked joy, send some sugar-spun appreciation.</h2>
              <p>
                Want to help keep the fun vibes flowing? Support the project at
                <a href="${supportUrl}" target="_blank" rel="noreferrer">buymeacottoncandy.com</a>.
              </p>
            </div>
            <a class="button button--primary" href="${supportUrl}" target="_blank" rel="noreferrer">Buy Me a Cotton Candy</a>
          </div>
        </section>
      </main>
      ${renderFooter()}
    </div>
    <script type="module" src="${withBase("/assets/app.js")}"></script>
  </body>
</html>`;
}

function writeGuidePages(docs: GuideDoc[]): void {
  for (const doc of docs) {
    const dir = path.join(outDir, "guides", doc.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "index.html"),
      `<!doctype html>
<html lang="en">
  <head>
    ${renderHead({
      title: `${doc.title} · ${siteName}`,
      description: doc.excerpt || siteDescription,
      pathName: `/guides/${doc.slug}/`,
      type: "article",
    })}
  </head>
  <body>
    <div class="page-shell">
      ${renderHeader()}
      <main class="guide-page">
        <article class="guide-article card reveal">
          <div class="guide-article__meta">
            <span class="pill">Guide</span>
            <a class="text-link" href="${withBase("/")}">← Back to home</a>
          </div>
          ${doc.html}
        </article>
      </main>
      ${renderFooter()}
    </div>
    <script type="module" src="${withBase("/assets/app.js")}"></script>
  </body>
</html>`,
      "utf8",
    );
  }
}

function writeSeoFiles(docs: GuideDoc[]): void {
  writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
  writeFileSync(
    path.join(outDir, "robots.txt"),
    [`User-agent: *`, `Allow: /`, `Sitemap: ${siteUrl}/sitemap.xml`].join("\n"),
    "utf8",
  );

  const urls = [
    `${siteUrl}/`,
    ...docs.map((doc) => `${siteUrl}/guides/${doc.slug}/`),
    `${siteUrl}/api/`,
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}
</urlset>`;

  writeFileSync(path.join(outDir, "sitemap.xml"), sitemap, "utf8");
}

function renderHead(input: { title: string; description: string; pathName: string; type: string }): string {
  const canonicalUrl = `${siteUrl}${input.pathName === "/" ? "/" : input.pathName}`.replace(/([^:]\/)\/+/, "$1");
  const imageUrl = buildAbsoluteUrl('/social-card.svg');
  return `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <meta name="description" content="${escapeHtml(input.description)}" />
    <meta name="theme-color" content="#7c3aed" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#09090f" media="(prefers-color-scheme: dark)" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${siteName}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="icon" href="${withBase("/favicon.svg")}" type="image/svg+xml" />
    <link rel="preload" href="${withBase("/assets/site.css")}" as="style" />
    <link rel="stylesheet" href="${withBase("/assets/site.css")}" />
    <meta property="og:site_name" content="${siteName}" />
    <meta property="og:title" content="${escapeHtml(input.title)}" />
    <meta property="og:description" content="${escapeHtml(input.description)}" />
    <meta property="og:type" content="${input.type}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:alt" content="OpenHue Client social preview card with colorful gradient lights" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(input.title)}" />
    <meta name="twitter:description" content="${escapeHtml(input.description)}" />
    <meta name="twitter:image" content="${imageUrl}" />`;
}

function renderHeader(): string {
  return `
    <header class="site-header">
      <a class="brand" href="${withBase("/")}">
        <span class="brand__icon">💡</span>
        <span>
          <strong>${siteName}</strong>
          <small>TypeScript Hue tooling</small>
        </span>
      </a>
      <nav class="nav">
        ${navLinks
          .map(
            (link) => `<a href="${link.href.startsWith("#") ? link.href : link.href}">${escapeHtml(link.label)}</a>`,
          )
          .join("")}
      </nav>
      <button class="theme-toggle" type="button" aria-label="Toggle color theme" data-theme-toggle>
        <span class="theme-toggle__emoji" aria-hidden="true">🌗</span>
        <span>Theme</span>
      </button>
    </header>`;
}

function renderFooter(): string {
  return `
    <footer class="site-footer">
      <p>Made for stylish local-network automation. Keep the glow going at <a href="${supportUrl}" target="_blank" rel="noreferrer">buymeacottoncandy.com</a>.</p>
      <p><a href="${withBase("/")}">Home</a> · <a href="${withBase("/api/")}">API reference</a> · <a href="${supportUrl}" target="_blank" rel="noreferrer">Support</a></p>
    </footer>`;
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      html.push(`<ul>${listItems.join("")}</ul>`);
      listItems = [];
    }
  };

  const flushCode = () => {
    html.push(
      `<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
    );
    codeLines = [];
    codeLanguage = "";
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.startsWith("```")) {
      flushList();
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim();
      }
      index += 1;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      index += 1;
      continue;
    }

    if (!line.trim()) {
      flushList();
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      listItems.push(`<li>${renderInlineMarkdown(line.slice(2).trim())}</li>`);
      index += 1;
      continue;
    }

    flushList();

    if (line.startsWith("# ")) {
      html.push(`<h1>${renderInlineMarkdown(line.slice(2).trim())}</h1>`);
    } else if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      html.push(`<h2 id="${slugify(heading)}">${renderInlineMarkdown(heading)}</h2>`);
    } else if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      html.push(`<h3 id="${slugify(heading)}">${renderInlineMarkdown(heading)}</h3>`);
    } else if (/^\d+\.\s/.test(line)) {
      const orderedItems: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index] ?? "")) {
        const orderedLine = (lines[index] ?? "").replace(/^\d+\.\s/, "");
        orderedItems.push(`<li>${renderInlineMarkdown(orderedLine.trim())}</li>`);
        index += 1;
      }
      html.push(`<ol>${orderedItems.join("")}</ol>`);
      continue;
    } else if (line.startsWith("> ")) {
      html.push(`<blockquote><p>${renderInlineMarkdown(line.slice(2).trim())}</p></blockquote>`);
    } else {
      const paragraphLines = [line.trim()];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        if (!next.trim() || /^(#|>|-|\d+\.|```)/.test(next)) {
          break;
        }
        paragraphLines.push(next.trim());
        index += 1;
      }
      html.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
    }

    index += 1;
  }

  flushList();
  if (inCodeBlock) {
    flushCode();
  }

  return html.join("\n");
}

function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => `<a href="${resolveHref(href)}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function resolveHref(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
    return href;
  }

  if (href === './' || href === '../') {
    return withBase('/');
  }

  if (href.endsWith('.md')) {
    const slug = path.basename(href, '.md');
    return withBase(`/guides/${slug}/`);
  }

  if (href.startsWith('docs/api')) {
    return withBase(`/api/${href.replace(/^docs\/api\/?/, '')}`);
  }

  return href;
}

function buildAbsoluteUrl(pathName: string): string {
  return `${siteOrigin}${withBase(pathName)}`.replace(/([^:]\/)\/+/, '$1');
}


function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeBasePath(input: string): string {
  if (!input || input === "/") {
    return "";
  }
  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  return withLeadingSlash.replace(/\/$/, "");
}

function withBase(pathName: string): string {
  const normalized = pathName.startsWith("/") ? pathName : `/${pathName}`;
  return `${basePath}${normalized}` || "/";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}
