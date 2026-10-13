import assert from "node:assert/strict";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { parse } from "parse5";

const origin = "https://documentation.invalid";
const editPrefix = "https://github.com/morluto/rea/edit/main/docs/";

const htmlFacts = (html) => {
  const ids = new Set();
  const links = [];
  const edits = [];
  const pending = [parse(html)];
  while (pending.length) {
    const node = pending.pop();
    const attributes = Object.fromEntries(
      (node.attrs ?? []).map(({ name, value }) => [name, value]),
    );
    if (attributes.id !== undefined) ids.add(attributes.id);
    if (node.tagName === "a" && attributes.href !== undefined) {
      links.push(attributes.href);
      if (attributes.class?.split(/\s+/u).includes("edit-link-button"))
        edits.push(attributes.href);
    }
    if (node.tagName === "img" && attributes.src !== undefined)
      links.push(attributes.src);
    pending.push(...(node.childNodes ?? []));
  }
  return { ids, links, edits };
};

const publishedPages = async (output) => {
  const pages = [];
  const pending = [""];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(resolve(output, directory), {
      withFileTypes: true,
    })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".html")) pages.push(path);
    }
  }
  return pages.sort();
};

/** Check all published pages; legacy route preservation remains independent. */
export const verifyDocumentationPages = async (
  documentationPath,
  legacyRoutes,
) => {
  const documentation = await realpath(documentationPath);
  const output = await realpath(resolve(documentation, ".vitepress/dist"));
  const pages = await publishedPages(output);
  const inventory = new Set(pages);
  for (const route of legacyRoutes)
    assert.ok(inventory.has(route + ".html"), route + ": missing legacy route");
  const facts = new Map();
  for (const page of pages)
    facts.set(page, htmlFacts(await readFile(resolve(output, page), "utf8")));

  let sourceLinks = 0;
  const checked = new Set();
  const sourceAliases = {
    "documentation.html": "README.md",
    "specs/index.html": "specs/README.md",
    "adr/index.html": "adr/README.md",
  };
  for (const [page, { links, edits }] of facts) {
    if (page !== "index.html" && page !== "404.html")
      assert.equal(
        edits.length,
        1,
        page + ": missing/ambiguous physical-source edit link",
      );
    for (const edit of edits) {
      assert.ok(
        edit.startsWith(editPrefix),
        page + ": unexpected edit repository",
      );
      const relative = decodeURIComponent(edit.slice(editPrefix.length));
      const source = resolve(documentation, relative);
      assert.ok(
        source.startsWith(documentation + sep),
        page + ": edit source escaped documentation root",
      );
      assert.ok(
        (await stat(source)).isFile(),
        page + ": edit source is missing",
      );
      assert.ok(
        (await realpath(source)).startsWith(documentation + sep),
        page + ": edit source resolves outside documentation root",
      );
      const expected = sourceAliases[page] ?? page.replace(/\.html$/u, ".md");
      if (sourceAliases[page] || page.includes("/"))
        assert.equal(
          relative,
          expected,
          page + ": edit link names another source",
        );
      else
        assert.equal(
          basename(relative),
          expected,
          page + ": edit source basename changed",
        );
      sourceLinks++;
    }
    for (const destination of links) {
      const url = new URL(destination, `${origin}/rea/${page}`);
      if (url.origin !== origin || !url.pathname.startsWith("/rea/")) continue;
      const key = url.pathname + url.hash;
      if (checked.has(key)) continue;
      let target = decodeURIComponent(url.pathname.slice("/rea/".length));
      if (!target || target.endsWith("/")) target += "index.html";
      else if (!basename(target).includes(".")) target += ".html";
      const physical = resolve(output, target);
      assert.ok(
        physical.startsWith(output + sep),
        destination + ": published path escaped output",
      );
      assert.ok(
        (await stat(physical)).isFile(),
        page + ": broken rendered target " + destination,
      );
      assert.ok(
        (await realpath(physical)).startsWith(output + sep),
        destination + ": target resolves outside output",
      );
      if (url.hash && target.endsWith(".html")) {
        const fragment = decodeURIComponent(url.hash.slice(1));
        assert.ok(
          facts.get(target)?.ids.has(fragment),
          page + ": missing rendered anchor " + destination,
        );
      }
      checked.add(key);
    }
  }
  return {
    ok: true,
    legacy_routes: legacyRoutes.length,
    published_html_pages: pages.length,
    physical_edit_links: sourceLinks,
    distinct_internal_targets_and_anchors: checked.size,
    scope:
      "all generated HTML links/images/anchors and physical edit sources; home/404 links are checked without requiring edit footers; external network links are not fetched",
  };
};
