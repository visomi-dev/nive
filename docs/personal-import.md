# Review a Codex budget plan in Nive

Run Codex, the stdio runtime and the Nive browser on the same machine. Use a fresh browser profile,
an isolated database and the [four synthetic documents](fixtures/personal-import/). Selecting a
document in Codex authorizes that client and its model provider to process it. Nive receives
structured proposals through loopback. Its encrypted browser vault stores the approved ledger,
source locators and replay receipts. It does not receive or retain the original attachments.

## Start the synthetic workspace

From the checkout, use the repository's Node and pnpm versions and rootless Podman Compose. The
commands below use a unique project and allocate loopback ports for the database and test mailbox.
Choose an available gateway port and keep this shell for cleanup. The runtime requires port 43871.

```sh
pnpm install --frozen-lockfile
NX_DAEMON=false pnpm nx run-many -t build -p web-gateway personal-runtime
project="nive-import-$(date +%s)-$$"
fixture="docs/fixtures/import-test.compose.yaml"
podman compose -p "$project" -f "$fixture" up -d --wait
pg_port=$(podman compose -p "$project" -f "$fixture" port postgres 5432)
smtp_port=$(podman compose -p "$project" -f "$fixture" port mail 1025)
podman compose -p "$project" -f "$fixture" port mail 8025
db_url="postgresql://local_agent_fixture:synthetic-compose-only@127.0.0.1:${pg_port##*:}/local_agent_test"
DATABASE_URL="$db_url" NX_DAEMON=false pnpm nx run backend-db:db-migrate
env -i PATH="$PATH" NODE_ENV=development NIVE_LOCAL_AGENT=1 HOST=127.0.0.1 PORT=18184 \
  AUTH_ORIGIN=http://localhost:18184 AUTH_RP_ID=localhost \
  DATABASE_URL="$db_url" SESSION_SECRET=synthetic-import-only-session-secret-32-bytes \
  SMTP_HOST=127.0.0.1 SMTP_PORT="${smtp_port##*:}" SMTP_FROM=auth@example.test \
  SMTP_ALLOW_INSECURE_LOCAL=true node dist/apps/web/gateway/main.js
```

Open `http://localhost:18184/app/en/personal` (or `/app/es/personal`). Create a synthetic account
using an `example.test` email. Retrieve its verification code from the loopback Mailpit web port
printed above. Create the personal vault using a PRF-capable passkey. Keep this tab open.

## Select documents in Codex

1. Configure the local `nive` MCP entry in Codex as shown in the [runtime guide](personal-runtime.md).
   Set its `NIVE_WEB_ORIGIN` to `http://localhost:18184`. Start a new Codex session. In the Nive
   tab enter the single-use code from the private runtime directory, select the **import** permission
   and confirm. An import does not require the grant to read account names or balances.
2. Select the CSV, XML, XLSX and PDF in Codex. In the tested Codex CLI, start in the fixture
   directory, type `@` and select each file from the file picker. This references local files in
   the chat. Codex can use local document readers for spreadsheets and text PDFs. An image-only PDF
   needs separate handling and is outside this test.
3. Send this request with the selections.

   > Analyze only the four synthetic documents I selected. Prepare one import in Nive for a new
   > MXN account named Synthetic Checking with a zero opening balance. Propose category budgets
   > for December 2026 and January 2027 using the observed October and November expenses. Explain
   > your assumptions about partial months. Treat the CFDI as possible evidence for the notebook
   > charge. Keep its UUID and the row, sheet or page references. Flag uncertainty. Use the
   > Nive import tool and leave the decision to me.

4. In Nive review each account and its future budget lines. Adjust the month, category, limit or
   historical months, or clear **Include in plan** for a line. The edit control labels limits in
   minor units and displays the currency amount. For each row choose a posting, skip it, or link
   its evidence to a proposed or existing movement. Confirm the direction of the CFDI and link it
   to the November notebook charge. Edit the tea note. **Review exact values** previews the plan
   for that account. **Approve and save batch** writes all reviewed accounts together.
5. Check the **Budget plan** and expand **Source movements** for the history behind a category.
   The five distinct movements yield an MXN 34.75 balance. November expenses total MXN 45.25
   and October expenses MXN 20.00. The refund is income. Notebook spending is MXN 44.50 across
   the two observed months. A simple two-month average yields MXN 22.25 per forecast month for
   stationery. Future limits are editable estimates and do not post future movements.
6. Ask Codex to retry the identical payload with the same request ID. It should receive
   `applied`. Refresh and unlock the vault to verify persistence. For a negative test, reject
   a fresh proposal and retry it in the same enrollment to see `rejected`. Try locking the
   vault or revoking the connection with a proposal open. A proposal lives at most five minutes
   and the enrollment at most fifteen. Restart the MCP process to pair again after revocation.
7. Stop the gateway, close Codex and remove this fixture's disposable services and volume
   using `podman compose -p "$project" -f "$fixture" down --volumes` in the original shell.
   Removing the throwaway browser profile also removes the synthetic browser vault.

## Local CSV and CFDI imports

The optional **Import CSV or CFDI on this device** workflow in Nive works independently of Codex.
Select a UTF-8 comma-delimited statement with a header. Map the columns by position. The mapper
recognizes ISO dates, positive decimal amounts, explicit income or expense and supported currency
codes. Correct ambiguous fields in the row editor or skip them. A CFDI 4.0 XML contributes its
total, currency, issue date and available stamped UUID. The person confirms settlement. Both entry
points use the same review, reconciliation and posting commands. No external header inference is
enabled. XLSX and PDF extraction belongs to the Codex client.

## Acceptance evidence

The November 25, 2026 session used Codex CLI 0.172.0 with its interactive file picker, a compiled
Nive stdio runtime, Chromium with a virtual PRF authenticator, and isolated PostgreSQL and Mailpit
services. The real client obtained the following source data.

| Selected file | Client read                            | Result checked in Nive                                         |
| ------------- | -------------------------------------- | -------------------------------------------------------------- |
| statement.csv | Three dated rows, with bank references | Two notebook expenses and a refund                             |
| register.xlsx | November worksheet, row 2              | One MXN 12.00 bus expense                                      |
| receipt.pdf   | Selectable text on page 1              | One MXN 8.75 tea expense, with a human-corrected note          |
| invoice.xml   | CFDI 4.0 total and stamped UUID        | Linked to the November bank charge, with no additional posting |

The first proposal was rejected. Codex retried it and received `rejected`, then prepared a new
proposal. After web approval Codex received `applied` on retry. The browser showed one account,
five postings and limits for December and January. Five postings remained after reloading and
unlocking. No original was selected in the web client during this run.

```sh
NX_DAEMON=false pnpm nx run-many -t test -p shared-finance personal-runtime web-app
```

The separate browser-local import check mapped the CSV columns, created an account, recognized the repeated CSV and linked the XML to its saved charge. The three bank rows remained three postings. The checked gateway request bodies contained none of the synthetic charge markers or XML.

The finance tests exercise historical vaults, exact currency arithmetic, multi-account atomicity,
duplicate references, ambiguous rows, invoice matching, linked budget evidence and durable replay.
The browser-service tests change authority while approval is awaiting revalidation. The runtime
tests use an official SDK client on stdio.

## Remaining work

The current browser holds the vault key and must stay open. Unattended runtime enrollment, a
standalone financial CLI, cross-device sync, the wider finance domain and the managed-agent
harness remain separate work. Budget lines in this slice represent monthly expense limits by
account and category. No OCR, bank connection, managed Railway agent or Private Files access was
part of acceptance.
