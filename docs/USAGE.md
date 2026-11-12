# Using tally

Task guides for the app as it ships. Button labels are the ones on screen.
Sign-in needs an invite; see [FAQ](FAQ.md).

## Log an expense right after paying

1. Tap the **+** button. The form opens in place.
2. Tap a category chip, then enter the **Amount** and a **Description**.
3. Under **Paid by**, pick who paid. Under **Split between**, pick who the expense is shared with.
4. Tap **Save**.

Dinner for ₹1,920.00, paid by you and split four ways, gives each person ₹480.00. The expense counts toward net positions straight away.

## Split by shares, percent or exact amounts

Under **How to split**, pick one of four modes:

- **Equal**: every participant pays the same.
- **Exact**: type the amount each person pays, in rupees. For a ₹900.00 cab, you ₹300.00 and Asha ₹600.00.
- **Shares**: type a weight per person. Two shares to you and one to Asha gives you ₹600.00 and Asha ₹300.00.
- **Percent**: type a percentage per person. They must add up to 100.

The form shows how much is left to allocate, or how much is over-allocated, until the numbers match. Odd paise go to the payer: ₹100.00 split three ways is ₹33.34 for the payer and ₹33.33 for each of the others. Any member can edit or delete an expense later; see [Fix a wrong expense](#fix-a-wrong-expense).

## Settle up over UPI

1. Open the ledger and go to the **Settle** tab.
2. Tap **Pay with UPI** on the payment you are making. tally opens your UPI app with the payee, the amount and a note already filled in.
3. Pay in the UPI app, then return to tally and tap **Record settlement**. Check that the method reads **UPI**.

To pay part of an amount, change the **Amount** before recording. The rest stays owed. If the payee has not added a UPI VPA, the method falls back to **Cash or bank transfer**. For a debt you will not collect, pick **Written off**. It is recorded as a settlement, never silently dropped.

## Settle everything with one person

1. Open the **Balances** tab. It shows what you and each person owe overall, across every ledger you share.
2. Tap the person, then **See how it settles**. The **Contributing ledgers** list shows where the amount comes from.
3. Tap **Record settlements**. One settlement is written into each listed ledger.

Guests have no UPI VPA, so they are left out and settled by hand.

## Add a guest who never signs in

Only the ledger owner can add a guest.

1. Open the ledger options menu and choose **Members**.
2. Tap **Add a guest**, enter a **Name**, and tap **Add**.

A guest splits like anyone and can pay. The owner records settlements for them. If a guest later joins for real, **Merge into...** moves every expense they paid or shared to the member you pick. The guest is retired, and this cannot be undone from there.

## Recurring expenses

1. Open the ledger options menu and choose **Recurring expenses**, then **New recurring expense**.
2. Fill in the expense, set **Every** to a number of days, weeks or months, and set **Starts**. **Ends** is optional. Without it, the series **Runs until the ledger is archived**.
3. Tap **Save**. tally creates each occurrence on schedule. After downtime it back-fills the missed ones, at most 50 per run.

Use **Pause** and **Resume** to stop and restart a series. **Delete series** keeps the occurrences already created. Edits affect future occurrences only. Archiving the ledger cancels the series.

## Import from Splitwise or Splid

1. Open the ledger options menu and choose **Import**.
2. Pick a **Splid (.xls)** or **Splitwise (.csv)** export. tally shows how many expenses it found and how many rows it skipped.
3. Match each name in the file to a member under **Match each name to a member**. The owner can choose **Create guest** for a name with no match.
4. Tap **Import**. Nothing is written until this step. An archived ledger does not accept imports.

## Export to CSV

- One ledger: open the ledger options menu and tap **Export this ledger**.
- Everything you can see: open the **You** tab and tap **Export everything**.

Both produce a plain CSV that opens in any spreadsheet.

## Invite someone to a ledger

Ledger invite links are off by default.

1. Open the ledger options menu and turn on **Allow invite links**.
2. Tap **Invite someone**, then **Copy link**.
3. Send the link to one person over a private channel. It works once and expires after 48 hours.

The person who joins gets a restricted account. It can use the ledgers they are in, and it cannot create ledgers or invites.

## Fix a wrong expense

Any member can edit or delete any expense. Open the expense, tap **Edit expense**, change it, and tap **Save changes**. Each edit is kept under **Edit history**. Tap **Restore** on an earlier version to put it back. Deleting an expense removes it from every balance, but nothing is hard deleted.

## Sign in with a passkey or a password

Both work on the same account. Use whichever you set up first, then add the other from the **You** tab.

- Passkey: under **Devices**, tap **Add passkey**. To sign in on another device, choose "use a phone or tablet" when your browser asks.
- Password: set an email, then tap **Set a password**. Password sign-in also works inside an in-app browser.

## Install it on your phone

1. Open tally in a browser and complete one action, such as saving an expense. After that, an **Install** prompt appears. It never appears on the first load.
2. On iPhone or iPad there is no install prompt. Open the share menu in Safari and choose **Add to Home Screen**. Web push on iOS only works from this installed app.
3. To get reminders, open the **You** tab and tap **Enable notifications**. Only two kinds are sent: someone settles with you, and a settle reminder.
4. When a new version is ready, tally shows **Reload**. It never reloads by itself, so a half-filled form is safe.

Push notifications are built, but they have not been tested on a real phone yet. If one does not arrive, check [FAQ](FAQ.md#are-push-notifications-working).
