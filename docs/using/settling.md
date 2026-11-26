# Settling up

tally never moves money. It works out who should pay whom, you pay over UPI, cash or bank transfer, and then you record the payment.

## Net positions

Each member of a ledger has a **net position**:

> Net position = paid − share + settlements sent − settlements received

Positive means you are owed. Negative means you owe. Every ledger's net positions add up to exactly ₹0.00, and the **Settle** section shows that check.

To see the working for each person, open **Settle** and tap **Show each member's figures**.

## Who pays whom

Under **Who pays whom**, the **Settle** section lists the payments that clear every net position. There are never more payments than one fewer than the number of people. The list is short, but it is not guaranteed to be the shortest possible.

### Why a payment exists

Tap **Show the expenses behind this** on any payment to see the expenses and earlier settlements it comes from. A payment can also clear balances that pass through other people. When that happens, tally says the expenses shown do not add up to the whole payment.

To see the debts between each pair of people before they were simplified, open **Show direct debts before simplifying**.

### The whole picture

The graph under **The whole picture** shows each member as a circle and each payment as an arrow. Switch between **Transfer plan** and **Direct debts**. Select an arrow to see why it exists, or a member to see their expenses. Drag to rearrange, pinch or use the buttons to zoom, and **Reset layout** to start over.

## Pay and record a settlement

1. In the ledger, open **Settle** and find a payment you are making.
2. Tap **Pay with UPI**. Your UPI app opens with the payee, amount and a note filled in. Pay there.
3. Back in tally, tap **Record settlement** and check that **How was it paid?** says **UPI**.

- To record a partial payment, change the **Amount**. The rest stays owed.
- If the person has no UPI VPA, there is no pay button. Pay however you like, pick **Cash or bank transfer**, and record it.
- **Written off** cancels a debt for good. Nobody is asked to pay it, and it shows in the ledger as a settlement, not a silent deletion. It cannot be undone.
- You can record a settlement for someone else, such as a guest, with **Record for** their name.

tally does not check that the payment went through. It records what you tell it.

## Settle everything with one person

The **Balances** tab adds up each person across every ledger you share.

1. Tap the person, then **See how it settles**. **Contributing ledgers** lists where the total comes from.
2. Tap **Record settlements**. tally writes one settlement in each listed ledger.

This records only what you owe them. If they also owe you in other ledgers, those stay as they are. Guests have no UPI VPA, so they are left out; settle them inside their ledger.

## Remind someone

On a payment someone owes you, **Send a reminder** sends them a push notification. You can nudge the same person once every 12 hours. Guests have no account, so there is no reminder for them.

## Export the settle-up

Tap **Export or print** in **Settle** for a CSV, an Excel workbook, or a one-page report you can print or save as a PDF. See [Insights, import and export](insights-and-export.md#export).
