import { readMailCode } from '@visomi-stack/dev-testing';

import { address, expect, password, test } from './support/fixtures';

const locales = [
  {
    locale: 'en',
    title: 'What would you like to organize first?',
    create: 'Create an account',
    codeLabel: 'Verification code',
    bring: 'Bring my transactions',
    local: 'Import in Nive',
    agent: 'Use my agent',
    onward: 'Start without files',
    personal: 'Personal finances',
    example: 'Open example dashboard',
  },
  {
    locale: 'es',
    title: '¿Qué quieres organizar primero?',
    create: 'Crear una cuenta',
    codeLabel: 'Código de verificación',
    bring: 'Traer mis movimientos',
    local: 'Importar en Nive',
    agent: 'Usar mi agente',
    onward: 'Empezar sin archivos',
    personal: 'Finanzas personales',
    example: 'Abrir panel de ejemplo',
  },
];

for (const { locale, title, create, codeLabel, bring, local, agent, onward, personal, example } of locales) {
  test(`offers a keyboard-accessible first use in ${locale} only after verified registration`, async ({ page }) => {
    const email = address();

    await page.setViewportSize({ width: 390, height: 844 });

    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto(`/app/${locale}/auth/sign-up/password`);

    await page.locator('input[type="email"]').fill(email);

    await page.locator('#account-password').fill(password);

    await page.getByRole('button', { name: create, exact: true }).click();

    const heading = page.getByRole('heading', { name: title, exact: true });
    const code = page.getByLabel(codeLabel, { exact: true });

    await expect(code).toBeVisible();

    await expect(heading).toHaveCount(0);

    const verifyCode = await readMailCode(email);

    await code.fill(verifyCode);

    await expect(page).toHaveURL(`/app/${locale}/welcome`);

    await expect(heading).toBeFocused();

    await expect(page.getByRole('link', { name: agent, exact: true })).toHaveCount(0);

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

    expect(overflows).toBe(false);

    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: bring, exact: true })).toBeFocused();

    await expect(page.getByRole('link', { name: onward, exact: true })).toBeVisible();

    await expect(page.getByRole('link', { name: example, exact: true })).toBeVisible();

    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: bring, exact: true })).toBeFocused();

    await expect(page.getByRole('link', { name: agent, exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: local, exact: true }).click();

    await expect(page.getByRole('heading', { name: local, exact: true })).toBeFocused();

    await page.reload();

    await expect(page.getByRole('heading', { name: local, exact: true })).toBeVisible();

    await page.getByRole('link', { name: onward, exact: true }).click();

    await expect(page.getByRole('heading', { name: personal, exact: true })).toBeFocused();

    await page.goto(`/app/${locale}/welcome`);

    await expect(page).toHaveURL(`/app/${locale}/home`);

    await expect(heading).toHaveCount(0);
  });
}
