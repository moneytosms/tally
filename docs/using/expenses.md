# Expenses

Any member can add, edit or delete any expense in a ledger they belong to. Every change is kept, so mistakes are cheap to fix.

## Add an expense

1. Tap **Add expense** (the **+** button).
2. Pick a category, then enter the **Amount** and a description.
3. Under **Paid by**, pick who paid. Under **Split between**, pick who shares it.
4. Tap **Save**.

Dinner for ₹1,920.00, paid by you and split four ways, gives each person ₹480.00. Balances update straight away.

You can also add **Notes**, and change the date if you paid on another day.

## Choose how to split

Under **How to split**, pick one of four modes:

- **Equal**: everyone pays the same.
- **Exact**: type each person's amount in rupees. For a ₹900.00 cab: you ₹300.00, Asha ₹600.00.
- **Shares**: type a weight per person. Two shares for you and one for Asha gives you ₹600.00 and Asha ₹300.00.
- **Percent**: type a percentage per person. They must add up to 100.

Until the numbers match, the form shows how much is left to allocate or how much is over. tally works in whole paise, so leftover paise have to go to someone: they go to the payer. ₹100.00 split three ways is ₹33.34 for the payer and ₹33.33 for each of the others. The split is saved exactly as shown, and never recalculated later.

## Categories

Categories are shared across the whole instance. Pick one when adding an expense, or leave it **Uncategorised**. The instance owner manages the list in the [admin panel](admin.md#categories).

## Comments

Open an expense and use **Comments** to ask a question or explain something ("this includes the tip"). Commenting does not change any amount.

## Fix a wrong expense

1. Open the expense and tap **Edit expense**.
2. Change what is wrong and tap **Save changes**.

**Edit history** keeps how the expense looked before each edit. Tap **Restore** on an earlier version to put it back. Deleting an expense removes it from every balance, but it is never hard-deleted.

## Search and filter

In a ledger's **Expenses** section, use **Search expenses** to find something by description. **Filter and sort** narrows the list by **Category**, **Person** and a date range, and changes the sort order. Each active filter shows as a chip; tap it to remove it, or **Clear all**.

## Recurring expenses

For rent, subscriptions or a shared bill that repeats.

1. In the ledger, open **Recurring expenses** and tap **New recurring expense**.
2. Fill in the expense. Set **Every** to a number of days, weeks or months, and set **Starts**.
3. **Ends** is optional. Without it, the series runs until the ledger is archived.
4. Tap **Save**.

tally adds each occurrence on schedule. If the instance was down, it fills in the missed ones later, at most 50 per run, and never twice.

- **Pause** and **Resume** stop and restart a series.
- Editing a series changes future occurrences only.
- **Delete series** keeps the occurrences already created.
