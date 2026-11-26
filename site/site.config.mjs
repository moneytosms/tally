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
  guide: ["docs/README.md", "docs/using/*.md", "docs/FAQ.md", "docs/DEPLOYMENT.md", "docs/OPERATIONS.md"],
  // Sidebar sections, in reading order, by guide slug. Contributor docs (spec,
  // architecture, ADRs) stay on GitHub: the guide is for people using tally.
  guideNav: [
    { name: "Start here", ids: ["index"] },
    {
      name: "Using tally",
      ids: ["using/getting-started", "using/ledgers", "using/expenses", "using/settling", "using/insights-and-export", "using/admin"],
    },
    { name: "Help", ids: ["faq"] },
    { name: "Self-hosting", ids: ["deployment", "operations"] },
  ],
  contributorDocs: `https://github.com/${owner}/${repoName}/tree/main/docs`,
  guideRoot: "README.md", // not in the guide; repo links to it go to GitHub
};
