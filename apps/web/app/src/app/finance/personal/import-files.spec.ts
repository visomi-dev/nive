import { mapCsv, readCfdi, readCsv } from './import-files';

const mapping = { date: 2, amount: 1, currency: 4, kind: 3, note: 0, reference: 5 };

it('maps selected columns, quoted CSV fields, source rows and uncertainty', () => {
  const records = readCsv(
    '\uFEFFmemo,value,day,type,code,ref\r\n"Paper, synthetic",15.20,2026-10-01,expense,MXN,TEST-1\r\nUncertain,1.001,01/02/26,?,MXN,TEST-2',
  );

  expect(mapCsv(records, mapping)).toMatchObject([
    {
      source: { format: 'csv', row: 2, reference: 'TEST-1' },
      amountMinor: '1520',
      kind: 'expense',
      note: 'Paper, synthetic',
      needsReview: false,
    },
    {
      source: { format: 'csv', row: 3, reference: 'TEST-2' },
      amountMinor: null,
      date: null,
      kind: null,
      needsReview: true,
    },
  ]);

  expect(() => readCsv('h\n' + 'row\n'.repeat(51))).toThrow();
});

it('reads a CFDI 4.0 invoice as evidence pending confirmation of settlement', () => {
  const text =
    '<c:Comprobante xmlns:c="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="15.20" Moneda="MXN" Fecha="2026-10-01T12:00:00"><c:Complemento><t:TimbreFiscalDigital xmlns:t="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="bf56ccf0-e809-4df2-b237-6817ac1aee02"/></c:Complemento></c:Comprobante>';

  expect(readCfdi(text)).toMatchObject({
    source: { format: 'cfdi', reference: 'bf56ccf0-e809-4df2-b237-6817ac1aee02' },
    amountMinor: '1520',
    date: '2026-10-01',
    kind: null,
    needsReview: true,
  });

  expect(() => readCfdi(text.replace('Version="4.0"', 'Version="3.3"'))).toThrow();
  expect(() => readCfdi('<!DOCTYPE x>' + text)).toThrow();
});
