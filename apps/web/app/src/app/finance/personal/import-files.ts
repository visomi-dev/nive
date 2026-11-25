import { currency, importSource, parseMoney, type ImportRow } from '@nive/finance';
import { parse } from 'csv-parse/browser/esm/sync';
import { z } from 'zod';

export const columns = ['date', 'kind', 'amount', 'currency', 'note', 'reference'] as const;
export type Mapping = Record<(typeof columns)[number], number>;

export function readCsv(text: string): string[][] {
  const records = z
    .array(z.array(z.string()).min(1).max(64))
    .min(2)
    .max(51)
    .parse(parse(text, { bom: true, relax_column_count: true, max_record_size: 8192, to: 52 }));

  return records;
}

function amount(raw: string, code: ImportRow['currency']): string | null {
  if (!code) {
    return null;
  }

  try {
    const minor = parseMoney(raw, code);

    return BigInt(minor) > 0n ? minor : null;
  } catch {
    return null;
  }
}

export function mapCsv(records: string[][], mapping: Mapping): ImportRow[] {
  return records.slice(1).map((cells, index) => {
    const get = (key: keyof Mapping) => cells[mapping[key]]?.trim() ?? '';
    const code = currency.safeParse(get('currency')).data ?? null;
    const date = z.iso.date().safeParse(get('date')).data ?? null;
    const kind = z.enum(['income', 'expense']).safeParse(get('kind')).data ?? null;
    const amountMinor = amount(get('amount'), code);
    const ref = importSource.shape.reference.safeParse(get('reference')).data;

    return {
      source: { format: 'csv', row: index + 2, ...(ref ? { reference: ref } : {}) },
      date,
      kind,
      currency: code,
      amountMinor,
      note: get('note').slice(0, 140),
      category: null,
      needsReview:
        !date ||
        !kind ||
        !amountMinor ||
        cells.length !== records[0].length ||
        Boolean(get('reference') && !ref) ||
        get('note').length > 140,
    };
  });
}

export function readCfdi(text: string): ImportRow {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) {
    throw new Error('xml_invalid');
  }

  const root = new DOMParser().parseFromString(text, 'application/xml').documentElement;

  if (
    root.namespaceURI !== 'http://www.sat.gob.mx/cfd/4' ||
    root.localName !== 'Comprobante' ||
    root.getAttribute('Version') !== '4.0'
  ) {
    throw new Error('cfdi_invalid');
  }

  const code = currency.safeParse(root.getAttribute('Moneda')).data ?? null;
  const stamps = root.getElementsByTagNameNS('http://www.sat.gob.mx/TimbreFiscalDigital', 'TimbreFiscalDigital');
  const reference = stamps.length === 1 ? z.uuid().safeParse(stamps[0].getAttribute('UUID')).data : undefined;

  return {
    source: { format: 'cfdi', ...(reference ? { reference } : {}) },
    kind: null,
    date: z.iso.date().safeParse(root.getAttribute('Fecha')?.split('T')[0]).data ?? null,
    currency: code,
    amountMinor: amount(root.getAttribute('Total') ?? '', code),
    category: null,
    note:
      root.getElementsByTagNameNS(root.namespaceURI, 'Concepto')[0]?.getAttribute('Descripcion')?.slice(0, 140) ?? '',
    needsReview: true,
  };
}
