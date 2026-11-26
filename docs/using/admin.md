# Admin

Each instance has one **Owner**: the person who claimed it when it was first deployed. Only the Owner sees **Admin panel** on the **You** tab. Everyone else can skip this page.

The Owner role is fixed. No screen can hand it to someone else, and the Owner's account cannot be deleted.

## Instance

The top of the panel shows:

- **Passkey domain**: the address passkeys are bound to. It is frozen. Changing it would destroy every passkey on the instance. See the [FAQ](../FAQ.md#why-does-a-passkey-stop-working-on-another-address).
- How many people and ledgers the instance has.
- Whether **Notifications** and **Recurring** expenses are configured. **Off** means a setting is missing from the deployment. See [Deploying tally](../DEPLOYMENT.md).

## Invite someone to tally

Under **Invite to tally**, tap **Create invite link** and send it to one person. It works once and expires after 48 hours. It creates a full account without putting them in any ledger; add them to ledgers afterwards.

**Open invites** lists every unused invite, both instance-wide and per ledger. **Revoke** kills one before it is used.

## People

**People** lists everyone with an account, with their sign-in methods.

| Action                      | When to use it                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Issue recovery link**     | Someone lost their phone. The link works once, expires in one hour, and re-enrols the same account on a new device, so their history stays theirs.            |
| **Revoke passkey**          | Remove a lost or old device. Their last passkey cannot be revoked; issue a recovery link first.                                                               |
| **Sign out everywhere**     | Ends every session on every device, for a lost device or a leaked password.                                                                                   |
| **Clear password**          | For a leaked password. They get back in with a passkey or a recovery link.                                                                                    |
| **Promote to full account** | Someone who joined through a ledger invite has a restricted account. Promoting lets them create ledgers and invites. It cannot be reversed.                   |
| **Delete account**          | Removes them from every ledger and signs them out. It needs their balance to be zero in every ledger. Past expenses stay, so recorded balances do not change. |

None of the emergency actions delete expense history.

For the full lost-phone procedure, see the [FAQ](../FAQ.md#what-if-someone-loses-their-phone).

## Categories

**Categories** are shared by every ledger on the instance. **Add category** with a name and an icon. **Delete** removes a category you added. Built-in categories are marked **Default** and cannot be deleted.

## Guests and members

The Owner is also the only person who can add guests to a ledger and remove members from one. See [Ledgers and people](ledgers.md#add-people).
