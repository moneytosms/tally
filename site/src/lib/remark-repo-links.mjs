// Rewrites relative links inside repo markdown rendered under /guide:
// a link to another guide doc becomes a site route, anything else in the
// repo (code, configs, archived docs) becomes a GitHub URL. Docs stay
// written for GitHub; the site adapts to them, not the other way round.
import path from "node:path";
import { fileURLToPath } from "node:url";
import cfg from "../../site.config.mjs";
import { BASE, RAW_URL, REPO_URL, isGuidePath, slugFor } from "./slug.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function walk(node, fn) {
  fn(node);
  if (node.children) for (const child of node.children) walk(child, fn);
}

export function rewriteRepoLinks() {
  return (tree, file) => {
    const source = file.path ?? file.history?.[0];
    if (!source || !path.resolve(source).startsWith(REPO_ROOT)) return;
    const fromDir = path.dirname(path.relative(REPO_ROOT, path.resolve(source)));

    const mapUrl = (url, isImage) => {
      if (!url || /^[a-z]+:|^\/\/|^#/i.test(url)) return url;
      const [target, hash] = url.split("#");
      const repoPath = path.posix.normalize(path.posix.join(fromDir.split(path.sep).join("/"), target));
      if (repoPath.startsWith("..")) return url;
      const anchor = hash ? `#${hash}` : "";
      // Images need file bytes rather than GitHub's HTML viewer.
      if (isImage) return `${RAW_URL}/${repoPath}`;
      if (isGuidePath(repoPath)) {
        const slug = slugFor(repoPath);
        return `${BASE}/guide/${slug === "index" ? "" : slug}${anchor}`;
      }
      const kind = target.endsWith("/") || !path.posix.extname(repoPath) ? "tree" : "blob";
      return `${REPO_URL}/${kind}/${cfg.branch}/${repoPath.replace(/\/$/, "")}${anchor}`;
    };

    walk(tree, (node) => {
      if (node.type === "html") {
        // Raw HTML (GitHub README <picture>, <a>, <img>): same rules as markdown nodes.
        node.value = node.value.replace(/(\s(?:src|srcset|href)=")([^"]+)"/gi, (m, pre, val) => {
          const isImg = !/href=/i.test(pre);
          const out = val.split(",").map((part) => {
            const [u, ...rest] = part.trim().split(/\s+/);
            return [mapUrl(u, isImg), ...rest].join(" ");
          });
          return `${pre}${out.join(", ")}"`;
        });
        return;
      }
      if (node.type !== "link" && node.type !== "definition" && node.type !== "image") return;
      if (node.url) node.url = mapUrl(node.url, node.type === "image");
    });
  };
}
