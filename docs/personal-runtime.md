# Use the Nive personal runtime with Codex

The local preview connects Codex to the personal finance workspace on a loopback Nive development
site. The signed-in browser holds the workspace key and performs the financial operations. A separate,
limited local inbox can receive imports while the tab is closed.
An independent WebAuthn PRF vault passkey unlocks the workspace. The gateway handles the account
session. The ledger and approved changes are encrypted with the existing vault format and
stored in this browser's IndexedDB.

For attachment analysis and a multi-month spending plan, follow the [synthetic Codex walkthrough](personal-import.md).

## Start and connect for the tab-bound tools

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

4. Sign in at the Nive development origin and open **Personal finances**. Open
   `~/.nive-runtime/pairing-code` in a trusted local editor and paste the code into the Nive form.
   Use the file within five minutes. Keep it out of chats, logs, prompts and Codex configuration.
   The runtime creates the file with owner-only permissions and removes it when consumed or expired.
5. Select which capabilities to grant and confirm the disclosure. Create or unlock the personal
   vault with a PRF-capable passkey and add an account. Keep the authorized Nive tab open.

Only the trusted browser should have the pairing code. The connection expires after 15 minutes.
Use **Lock vault** to stop access immediately or **Revoke agent connection** to end the grant.
Sign-out and leaving the page end the browser grant. Restart the MCP process to obtain a new code
after ending the grant or closing/reloading the tab. A person with access to the same OS account or
a compromised browser can bypass local trust boundaries. Revocation cannot recall data already
returned to the MCP client or its model provider.

## Local import inbox while the tab is closed

This development preview supports a separate inbox for `nive_prepare_import` on one browser vault
and one local runtime installation. It does not copy the financial ledger. Account and movement
summaries and individual movement drafts still use the separate tab-bound preview, whose grants
expire on lock, sign-out, tab close or timeout.

1. Start the local Codex MCP process. On the same computer, sign into Nive and open the personal
   vault. Find **Local import inbox** in Personal finances or from **Use my agent** during onboarding.
2. Enter the private one-use code, confirm consent, then click **Authorize inbox for 15 minutes**.
   Pairing alone grants no intake. Close the tab if desired and keep the runtime running.
3. Select the synthetic attachments in Codex and ask it to prepare an import. Codex and its model
   provider can process the selected files. The tool accepts structured proposals. It has no file,
   path, URL, credential or approval input, and the runtime does not get access to the original files.
4. Reopen Nive and unlock the vault. Review the proposal when it appears. Use **Check for
   proposals** if the runtime became available after unlock. Only **Approve and save batch**
   can add the reviewed accounts, movements or budget. An identical retry of the latest request
   returns its recorded result during an active authorization. Reopening a reviewed import still
   uses the shared financial receipt and duplicate checks.

### What is stored and how access ends

- The encrypted browser vault holds the installation ID, an independently generated inbox key,
  a random control token and the latest review decision. The financial ledger and keys stay in
  the browser. Authorizing checks the account session and the currently open vault again.
- The loopback runtime checks the exact Nive development origin and host, the one-use code during
  pairing and the per-installation token on later requests. The code expires after five minutes.
  The local OS account owns the runtime directory and its files. The scoped authorization goes
  directly to that loopback process with cookies omitted, outside the Nive backend and MCP client.
- The process holds the inbox key in memory for up to 15 minutes, until revoked or until the
  process stops. It checks the deadline when handling a request. It writes only AES-256-GCM
  ciphertext for one proposal at a time, using a random nonce and binding the ciphertext to the
  installation and request IDs. The owner-only file also contains the IDs, commitments and latest
  decision status. The final decision is committed with the reviewed ledger in one encrypted
  revision, so the browser can retry acknowledgement after a broken connection.
- Closing the tab, locking it or losing the web session prevents web review and approval until
  the account session and open vault are available again. It does not extend or cancel a previously
  granted runtime intake window. A restart preserves pending ciphertext and pairing, and requires
  an explicit new authorization to accept new proposals. A pending proposal can still be reviewed
  once the browser vault is unlocked.
- **Revoke this installation** first records revocation in the browser vault, preventing further
  review and approval there. If the runtime is available, it also discards the pending proposal
  and drops its intake key immediately. If disconnected, retry revocation when it returns. The
  process cannot detect revocation or account sign-out offline and can accept data until its
  existing authorization expires. On a shared or compromised host, the loopback process and
  browser cannot provide isolation against software that can control the local OS account or
  impersonate the local service. Treat the host and runtime directory as trusted. The pending
  proposal stays on this machine and is unavailable if its local ciphertext or the browser vault
  is lost. This preview does not implement remote sync, backups for this inbox or a managed agent.

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

| Tool                     | Input                                                                                                                                                                       | Result                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `nive_financial_summary` | Calendar month in `YYYY-MM` format                                                                                                                                          | Account names, IDs, currencies, current balances and income and expenses per currency for the selected month. Transfers only affect balances. |
| `nive_prepare_import`    | Up to 50 structured rows in up to eight account groups, source locators and optional monthly budget lines.                                                                  | Proposal ID and status. The browser validates and reviews the plan before saving.                                                             |
| `nive_prepare_movement`  | Unique `requestId` UUID and a movement with account ID, type, date, positive minor-unit amount and note. Transfers also require a destination account in the same currency. | A proposal ID and status for the authorized workspace.                                                                                        |

The financial values returned by the summary are decimal strings in integer minor units. For
example, `2500` in MXN means MXN 25.00. Names and values returned in a query may be visible to the
agent and its model provider. Authorize only the capabilities and data you want them to have.

The tab-bound tools queue one proposal at a time for up to five minutes. In Nive, edit or reject
the proposed movement. **Review exact values** shows the amount, currency, dates, accounts and
note that will be committed. **Approve and save movement** writes the reviewed version, then the
movement and balances appear in the browser and subsequent summaries. Reuse the same request ID on
a retry. Changing a previously used ID's payload is rejected. Approval exists only in the web UI.

For a local check, use a synthetic account and a synthetic expense. Check that the balance changes
once after explicit approval and that refreshing and unlocking the same browser shows the same
movement. Try denying one capability, locking the vault, and revoking the grant. The build's
`personal-runtime:test` target exercises the official MCP client over real stdio with local fixtures.

This preview uses browser-local data. Cross-device sync, indefinite authorizations, the full v6 budget domain,
corrections, standalone CLI and managed harness are outside this slice. The
app does not send the workspace key or financial plaintext to the gateway.
