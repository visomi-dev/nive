# Use the Nive personal runtime with Codex

The local preview connects Codex to the personal finance workspace on a loopback Nive development
site. The browser holds the workspace key, the ledger of record and the approval UI. An independent
WebAuthn PRF passkey unlocks that vault in IndexedDB. A paired runtime can read a disposable encrypted
copy and receive structured proposals during a separately authorized window, including when the
browser is closed.

For attachment analysis and a multi-month spending plan, follow the [synthetic Codex walkthrough](personal-import.md).

## Start the runtime

1. Run the existing [local Compose setup](development.md#gateway-inside-podman) with the private
   root `.env` setting `NIVE_LOCAL_AGENT=1`. Use `localhost` as the browser hostname and set
   `AUTH_ORIGIN` to the same origin, including the port. The development gateway allows its app to
   connect to the one fixed loopback address used by the runtime.
2. In a trusted copy of the repo on the same Unix machine as Codex and the browser, install the
   locked dependencies and build the runtime.

   ```sh
   pnpm install --frozen-lockfile
   NX_DAEMON=false pnpm nx build personal-runtime
   ```

3. Add the entry below to your user Codex configuration and start a new Codex session. Use
   absolute paths and adjust `NIVE_WEB_ORIGIN` if you use a custom gateway port. Codex launches the
   process on stdio. Keep port 43871 local to that machine.

   ```toml
   [mcp_servers.nive]
   command = "/absolute/path/to/node"
   args = ["/absolute/path/to/nive/dist/apps/personal-runtime/main.mjs"]

   [mcp_servers.nive.env]
   NIVE_WEB_ORIGIN = "http://localhost:8080"
   ```

4. Sign in at the Nive development origin. Open `~/.nive-runtime/pairing-code` in a trusted
   local editor. Use the code within five minutes. Keep it out of chats, logs, prompts and Codex
   configuration. The runtime creates the file with owner-only permissions and removes it when
   consumed or expired.

## Use the paired runtime with the tab closed

1. Open **Local runtime** in Personal finances or choose **Use my agent** during onboarding.
   Open the personal vault, enter the one-use code and confirm trust. An existing import-only
   enrollment can finish its drafts. To enable the new permissions, revoke that enrollment, restart
   the runtime and pair it with a fresh code.
2. Choose the tools to authorize and click **Authorize for 15 minutes**. **Share account names,
   balances and monthly totals** captures a read-only copy of the latest saved web revision.
   **Prepare individual movement proposals** and **Prepare import proposals** are separate grants.
   A fresh authorization replaces the previous selection. Keep the Codex session and its runtime
   running when you close the tab.
3. Reopen Nive and unlock the vault to see a pending proposal. **Check for proposals** retries
   if the runtime became available after unlock. Review exact values and explicitly approve
   the movement or the import batch. The Web uses its current ledger, so a stale read copy
   cannot authorize or overwrite a write. A proposal remains reviewable after the runtime
   lease expires or the runtime restarts.

### Reproduce with a synthetic movement

Create a fresh test account with an opening balance of MXN 100.00. Grant summary and movement
preparation, leave import unchecked and close all Nive tabs. Ask Codex for
`nive_financial_summary` for the test month. Use the account ID it returns and a new UUID to ask
`nive_prepare_movement` for an expense of 725 minor units in that same month. The tool should
return `pending`. Restart Codex with the same runtime directory. The summary should return
`locked` until you grant access again.

Reopen the same browser profile. Unlock the vault and review the draft before saving. There
should be zero movements until approval and one afterwards. Reload, unlock, grant summary and
movement preparation again, and ask Codex to retry the identical request and ID. It should
return `applied` with a single posting in the web ledger. The new summary should return balance
`9275` and expenses `725`. The tested recovery also drops the encrypted `finish` response after
the runtime processes it. The browser commits the review receipt and posting together, so losing
that acknowledgement leaves the same result.

### Custody, freshness and revocation

The local model follows the device, custody and operation boundaries of v6 M13. The browser
authenticates the user with the account session and the separate vault unlock. The one-use
pairing code proves local possession. The browser and enrolled runtime authenticate subsequent
control messages with a per-installation key, an expiring one-use challenge and AES-GCM. The
request and response bind the operation, challenge and direction. The browser uses the fixed
loopback address with cookies omitted. The runtime checks the exact configured origin and host.

The owner-only runtime directory stores the device control secret, a commitment to the separate
proposal key, and ciphertext. The runtime generates a distinct AES-GCM key for the current read
copy and retains it only in memory during an active summary authorization. The copy contains the
saved accounts, movement amounts and dates, categories and budget records. It excludes private
notes, attachment references, approval receipts and browser key material. A summary uses the
shared finance calculation and returns the snapshot revision and capture time. To refresh the
copy after a web change or process restart, authorize summary again from an unlocked web vault.
Movement and import grants do not release the read-copy key. A movement-only proposal is checked
against the actual accounts when reviewed in the web vault.

The runtime keeps one encrypted unresolved proposal at a time. The browser retains its proposal
key so it can recover the draft after a runtime restart. It commits the final decision with the
reviewed ledger revision and acknowledges the runtime afterwards. A lost acknowledgement can be
retried. The financial receipt remains in the authoritative browser ledger.

Closing the tab, locking it or signing out suspends web review. A previously granted runtime
authorization expires within its original 15-minute window. Restarting the runtime discards
all active permissions and in-memory keys. Use **Revoke this installation** to record revocation
in the browser vault immediately and discard the runtime copy and pending proposal when reachable.
If the runtime cannot be reached, the local lease may continue until its original deadline.
Retry when it returns. A trusted local OS account and runtime directory are part of this preview.
Software with control of the same OS account or an unlocked process may bypass that boundary.
Revocation cannot recall summaries already given to Codex or its model provider.

The separate tab-bound preview remains available for earlier setups. Its grants end on lock,
sign-out, navigation or timeout. This preview keeps data on one computer and does not synchronize
the read copy or the proposals remotely.

### Web account session and vault inactivity

The account session can last up to 30 days from creation. The server still enforces its absolute
deadline and existing revocation controls. Reloading a browser with a valid account session and a
configured vault prompts for the vault method. A first-use account goes to setup. Personal
Finances uses a PRF-capable passkey. The existing Stack vault supports local PIN where configured.

On the web, five minutes without trusted input locks the vault. Hidden time counts and a tab
switch does not itself lock or renew it. Runtime calls, application traffic and synthetic events
do not count as activity. The app checks the deadline when the tab returns and before and after
vault operations, independent of timer delivery. The existing Stack BrowserVault and DeviceCustody
retain custody in browser memory. Moving the timer to a worker would leave those key handles
in the page and could still be suspended. Exclusive worker custody would require moving the
crypto and IndexedDB operations behind a new boundary. This preview keeps the existing custody
and checks the deadline directly.

## Tools and review

| Tool                     | Input                                                                                                                                                                       | Result                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nive_financial_summary` | Calendar month in `YYYY-MM` format                                                                                                                                          | Account names, IDs, currencies, balances and monthly per-currency totals. Enrolled-device summaries include the read copy revision and capture time. |
| `nive_prepare_import`    | Up to 50 structured rows in up to eight account groups, source locators and optional monthly budget lines.                                                                  | Proposal ID and status. The browser validates and reviews the plan before saving.                                                                    |
| `nive_prepare_movement`  | Unique `requestId` UUID and a movement with account ID, type, date, positive minor-unit amount and note. Transfers also require a destination account in the same currency. | A proposal ID and status for the authorized workspace.                                                                                               |

The financial values returned by the summary are decimal strings in integer minor units. For
example, `2500` in MXN means MXN 25.00. Names and values returned in a query may be visible to the
agent and its model provider. Authorize only the capabilities and data you want them to have.

The tab-bound preview queues one proposal at a time for up to five minutes. The paired runtime
keeps one pending proposal until disposition. In Nive, edit or reject the proposed movement. **Review exact values** shows the amount, currency, dates, accounts and
note that will be committed. **Approve and save movement** writes the reviewed version, then the
movement and balances appear in the browser. Reauthorize summary to update the paired copy. Reuse the same request ID on
a retry. Changing a previously used ID's payload is rejected. Approval exists only in the web UI.

For a local check, use a synthetic account and a synthetic expense. Check that the balance changes
once after explicit approval and that refreshing and unlocking the same browser shows the same
movement. Try denying one capability, locking the vault, and revoking the grant. The build's
`personal-runtime:test` target exercises the official MCP client over real stdio with local fixtures.

This preview uses browser-local data. Cross-device sync, indefinite authorizations, the full v6 budget domain,
corrections, standalone CLI and managed harness are outside this slice. The
app does not send the workspace key or financial plaintext to the gateway.
