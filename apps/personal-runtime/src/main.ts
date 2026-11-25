import { randomBytes } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  importInput,
  localWebOrigin,
  pairingLifetime,
  preparationInput,
  runtimeCall,
  summaryInput,
} from '@nive/finance';
import { z } from 'zod';

import { RuntimeInbox } from './inbox';
import { Broker } from './broker';
import { startLoopback } from './loopback';

const toolCapabilities = new Map([
  ['nive_financial_summary', 'read-summary'],
  ['nive_prepare_movement', 'prepare-movement'],
  ['nive_prepare_import', 'prepare-import'],
]);
const tools = [
  {
    name: 'nive_prepare_import',
    description:
      'Queue up to 50 structured rows from the files the person shared for review in Nive. Never send files, paths, URLs or keys. Group rows by account and currency. Up to eight accounts. For a requested budget plan, categorize expenses and propose monthly per-category limits supported by the observed basisMonths. Use the same category on its underlying expenses. Exclude duplicate invoice evidence from the spending pattern. Use null for unknown fields and mark ambiguous rows needsReview. An invoice is not proof of payment. Use the attachment position as document and keep available row, sheet, page and transaction reference or CFDI UUID. Use positive exact minor-unit strings. Use empty budgets when none requested. Retry the identical payload with the same requestId. Only the person can approve in Nive.',
    inputSchema: z.toJSONSchema(importInput),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'nive_financial_summary',
    description:
      'List personal accounts and balances, plus income and expenses for a selected month by currency. Amounts are exact minor-unit strings.',
    inputSchema: z.toJSONSchema(summaryInput),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'nive_prepare_movement',
    description:
      'Queue an income, expense or transfer in Nive for human review. Never posts it. Use a UUID requestId and reuse it on retry. amountMinor is a positive exact minor-unit string.',
    inputSchema: z.toJSONSchema(preparationInput),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

async function main(): Promise<void> {
  const origin = localWebOrigin(process.env['NIVE_WEB_ORIGIN'] ?? 'http://localhost:8080');
  const directory = process.env['NIVE_RUNTIME_DIR'] ?? join(homedir(), '.nive-runtime');

  if (!origin || !isAbsolute(directory)) {
    throw new Error('invalid_configuration');
  }

  await mkdir(directory, { mode: 0o700, recursive: true });

  const info = await lstat(directory);

  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) {
    throw new Error('private_directory_required');
  }

  const path = join(directory, 'pairing-code');
  const code = randomBytes(32).toString('hex');
  let published = false;
  const broker = new Broker(code, () => {
    if (published) {
      void rm(path, { force: true }).catch(() => undefined);
    }
  });
  const { inbox, stop: stopListener } = await startLoopback(broker, origin, () => new RuntimeInbox(directory));
  const temp = join(directory, randomBytes(12).toString('hex'));

  try {
    await writeFile(temp, code + '\n', { mode: 0o600, flag: 'wx' });

    await rename(temp, path);

    published = true;
  } catch (error) {
    await rm(temp, { force: true });

    stopListener();

    throw error;
  }

  const server = new Server({ name: 'nive-personal', version: '0.1.0' }, { capabilities: { tools: {} } });
  const transport = new StdioServerTransport();
  const expires = setTimeout(() => broker.expirePairing(), pairingLifetime);
  let stopping = false;
  const close = () => {
    if (!stopping) {
      stopping = true;
      clearTimeout(expires);
      broker.close();
      inbox.lock();
      stopListener();
      void server.close().catch(() => undefined);
    }
  };

  server.onclose = close;
  process.stdin.once('end', close);
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ inputSchema, ...tool }) => ({ ...tool, inputSchema: { ...inputSchema, type: 'object' } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const capability = toolCapabilities.get(params.name);
    const call = runtimeCall.safeParse({ capability, input: params.arguments ?? {} });
    let result: Awaited<ReturnType<Broker['invoke']>> = { error: 'invalid' };

    if (call.success) {
      try {
        if (inbox.enrolled()) {
          result = inbox.invoke(call.data);
        } else {
          const browserResult = await broker.invoke(call.data);

          result = browserResult;
        }
      } catch {
        result = { error: 'unavailable' };
      }
    }

    return {
      isError: 'error' in result,
      structuredContent: result,
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  });

  await server.connect(transport).catch(() => {
    close();

    throw new Error('stdio_unavailable');
  });
}

void main().catch(() => {
  process.stderr.write('Nive runtime could not start. Check the local origin, runtime directory and loopback port.\n');
  process.exitCode = 1;
});
