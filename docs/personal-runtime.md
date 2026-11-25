# Use the Nive personal runtime with Codex

The local preview connects Codex to the personal finance workspace on a loopback Nive development
site. The signed-in browser tab holds the workspace key and performs the financial operations.
An independent WebAuthn PRF vault passkey unlocks the workspace. The gateway handles the account
session. The ledger and approved changes are encrypted with the existing vault format and
stored in this browser's IndexedDB.

For attachment analysis and a multi-month spending plan, follow the [synthetic Codex walkthrough](personal-import.md).

## Start and connect

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

## Tools and review

| Tool                     | Input                                                                                                                                                                       | Result                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `nive_financial_summary` | Calendar month in `YYYY-MM` format                                                                                                                                          | Account names, IDs, currencies, current balances and income and expenses per currency for the selected month. Transfers only affect balances. |
| `nive_prepare_import`    | Up to 50 structured rows in up to eight account groups, source locators and optional monthly budget lines.                                                                  | Proposal ID and status. The browser validates and reviews the plan before saving.                                                             |
| `nive_prepare_movement`  | Unique `requestId` UUID and a movement with account ID, type, date, positive minor-unit amount and note. Transfers also require a destination account in the same currency. | A proposal ID and status for the authorized workspace.                                                                                        |

The financial values returned by the summary are decimal strings in integer minor units. For
example, `2500` in MXN means MXN 25.00. Names and values returned in a query may be visible to the
agent and its model provider. Authorize only the capabilities and data you want them to have.

The preparation tool queues one proposal at a time for up to five minutes. In Nive, edit or reject
the proposed movement. **Review exact values** shows the amount, currency, dates, accounts and
note that will be committed. **Approve and save movement** writes the reviewed version, then the
movement and balances appear in the browser and subsequent summaries. Reuse the same request ID on
a retry. Changing a previously used ID's payload is rejected. Approval exists only in the web UI.

For a local check, use a synthetic account and a synthetic expense. Check that the balance changes
once after explicit approval and that refreshing and unlocking the same browser shows the same
movement. Try denying one capability, locking the vault, and revoking the grant. The build's
`personal-runtime:test` target exercises the official MCP client over real stdio with local fixtures.

This preview uses browser-local data. Cross-device sync, unattended operation, the full v6 budget domain,
corrections, standalone CLI and managed harness are outside this slice. The
app does not send the workspace key or financial plaintext to the gateway.
