// The one file you edit per project. Everything else reads from here.
// Placeholders are filled by the skill's scripts/init.sh from `git remote`.
const owner = "moneytosms";
const repoName = "tally";

export default {
  name: "tally",
  tagline: "Expense splitting that shows its working. Exact to the paisa. Self-hosted, free on Cloudflare.",
  description: "Self-hosted expense splitting PWA for friend groups. Integer-paise ledgers, suggested transfers that each explain themselves, full edit history. Never touches your money. MIT.",
  owner,
  repoName,
  branch: "main",
  repoUrl: `https://github.com/${owner}/${repoName}`,
  // Project Pages live at https://OWNER.github.io/REPO/. For a custom domain
  // set site to https://docs.example.com and base to "".
  site: `https://${owner}.github.io`,
  base: `/${repoName}`,
  // Shown in the footer. State real constraints (synthetic data, alpha, etc.).
  footnote: "Demo data is fictional. tally never moves money.",
  // Markdown rendered in place under /guide (repo-relative globs, "!" excludes).
  // No copies: a doc fixed in the repo is fixed on the site at the next build.
  guide: [
    "README.md",
    "CONTRIBUTING.md",
    "docs/USAGE.md",
    "docs/FAQ.md",
    "docs/DEPLOYMENT.md",
    "docs/OPERATIONS.md",
    "docs/ARCHITECTURE.md",
    "docs/SPEC.md",
    "docs/adr/*.md",
  ],
  guideRoot: "README.md", // becomes /guide/readme; docs/README.md becomes /guide/
};
