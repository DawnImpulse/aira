// Stamps the latest v* tag into every [data-latest] on the website, so the pages show the current version even
// before (or without) the GitHub API lookup in site.js. Run before publishing the site: bun run site:version
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
// The highest v* tag, not the nearest one: a feature branch may have forked before the latest release.
const tag = execFileSync("git", ["tag", "--list", "v*", "--sort=-v:refname"]).toString().trim().split("\n")[0];
for (const page of ["index", "features", "guide", "feedback"]) {
  const path = new URL(`../docs/${page}.html`, import.meta.url).pathname;
  const html = readFileSync(path, "utf8");
  const out = html.replace(/(<span data-latest>)[^<]*(<\/span>)/g, `$1${tag}$2`);
  if (out !== html) writeFileSync(path, out);
}
console.log("site version:", tag);
