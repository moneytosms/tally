# The tally guide

tally splits costs on shared ledgers: a trip, a flat, or just you and one other person. It keeps every amount exact to the paisa, suggests a short list of payments that settles everyone, and can show why each payment exists. It never moves money; you pay over UPI or cash and record it.

New here? [Try the demo](https://tally.moneytosms.workers.dev/demo). It runs in your browser on sample data, with no sign-up.

## Using tally

| Page                                                        | What it covers                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Getting started](using/getting-started.md)                 | Joining with an invite, passkeys and passwords, installing on your phone, your profile |
| [Ledgers and people](using/ledgers.md)                      | Trips, groups and one-on-ones, inviting people, guests, archiving                      |
| [Expenses](using/expenses.md)                               | Adding and splitting, categories, comments, edit history, search, recurring expenses   |
| [Settling up](using/settling.md)                            | Net positions, who pays whom and why, paying over UPI, settling across ledgers         |
| [Insights, import and export](using/insights-and-export.md) | Spending charts, the activity feed, Splitwise and Splid import, CSV, Excel and PDF     |
| [Admin](using/admin.md)                                     | For the instance owner: people, invites, recovery, categories                          |

## Help

[Troubleshooting and FAQ](FAQ.md) covers sign-in problems, offline behaviour, notifications and lost phones.

## Self-hosting

One instance serves a friend group of about 20 people and runs on Cloudflare's free tier.

- [Deploying tally](DEPLOYMENT.md): from an empty Cloudflare account to a claimed instance.
- [Running a tally instance](OPERATIONS.md): adding people, schema changes, backups and recovery.

## Words used in this guide

- **Ledger**: one shared set of expenses and settlements, with its own members.
- **Net position**: what a member has paid, minus their share, adjusted for settlements. Positive means they are owed; negative means they owe. Every ledger's net positions add up to zero.
- **Settlement**: a payment recorded between two members. tally records it; the money moves outside tally.
- **Guest**: a member who never signs in. Someone else records things for them.
- **Owner**: the one person who administers the whole instance.
