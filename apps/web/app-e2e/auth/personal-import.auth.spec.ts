import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';

import { expect, signup, test, virtualPasskey } from './support/fixtures';

test('applies only the reviewed local batch and keeps returning vaults out of first use', async ({ page }) => {
  await signup(page);

  await virtualPasskey(page);

  await page.getByRole('link', { name: 'Personal finances', exact: true }).click();

  await page.getByRole('link', { name: 'Bring my transactions', exact: true }).click();

  await page.getByRole('link', { name: 'Import in Nive', exact: true }).click();

  await page.getByRole('button', { name: 'Create personal vault with a passkey' }).click();

  await expect(page.getByRole('heading', { name: 'Import in Nive' })).toBeVisible();

  const file = join(workspaceRoot, 'docs/fixtures/personal-import/statement.csv');
  const importer = page.locator('app-local-import');
  const input = importer.locator('input[type=file]');

  await input.setInputFiles(file);

  await importer.getByRole('button', { name: 'Review mapped rows' }).click();

  const review = importer.locator('app-import-review');

  await review.getByRole('button', { name: 'Reject proposal' }).click();

  await input.setInputFiles(file);

  await importer.getByRole('button', { name: 'Review mapped rows' }).click();

  await review.getByRole('combobox', { name: 'Account', exact: true }).selectOption('new');

  await review.getByRole('textbox', { name: 'Account name', exact: true }).fill('Synthetic local account');

  await review.getByRole('combobox', { name: 'Currency', exact: true }).first().selectOption('MXN');

  await review.getByRole('textbox', { name: 'Opening amount', exact: true }).fill('0');

  const decisions = await review.getByRole('combobox', { name: 'Row decision' }).all();

  for (const decision of decisions) {
    await decision.selectOption('post');
  }

  await review.getByRole('button', { name: 'Review exact values' }).click();

  await expect(page.getByRole('heading', { name: 'Import complete' })).toHaveCount(0);

  await review.getByRole('button', { name: 'Approve and save batch' }).click();

  const result = page.getByRole('region', { name: 'Import complete' });

  await expect(result.getByRole('heading')).toBeFocused();

  await expect(result.getByRole('link', { name: 'Accounts' })).toBeVisible();

  await expect(result.getByRole('link', { name: 'Budgets' })).toHaveCount(0);

  await result.getByRole('link', { name: 'Movements' }).click();

  await expect(page.getByRole('heading', { name: 'Movements', exact: true })).toBeFocused();

  const movements = page.getByRole('region', { name: 'Movements' }).locator('.break-words > li');

  await expect(movements).toHaveCount(3);

  await importer.locator('summary').click();

  await input.setInputFiles(file);

  await importer.getByRole('button', { name: 'Review mapped rows' }).click();

  await expect(importer.getByText('This batch is already in the vault.')).toBeVisible();

  await expect(movements).toHaveCount(3);

  await page.getByRole('button', { name: 'Lock vault' }).click();

  await expect(page.getByRole('heading', { name: 'Import in Nive', exact: true })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Unlock with vault passkey' })).toBeVisible();

  await page.reload();

  await page.getByRole('button', { name: 'Unlock with vault passkey' }).click();

  await expect(movements).toHaveCount(3);

  await expect(page.getByRole('heading', { name: 'Import in Nive', exact: true })).toHaveCount(0);
});
