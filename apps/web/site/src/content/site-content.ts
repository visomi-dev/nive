import type { SiteLocale } from './site';

type SiteCopy = {
  description: string;
  eyebrow: string;
  hero: string;
  title: string;
};

const siteContent: Record<SiteLocale, SiteCopy> = {
  en: {
    eyebrow: 'Your money, with a little more clarity',
    title: 'Life moves. Your money makes sense.',
    description:
      'Nive helps you organize your money in a private space, with separate family spaces when you need them.',
    hero: 'Turn your statements and invoices into a clearer picture. Plan your next month, follow your spending and make room for what matters.',
  },
  es: {
    eyebrow: 'Entiende mejor tu dinero',
    title: 'Tus finanzas, más claras. Tu vida cambia.',
    description:
      'Nive te ayuda a organizar tus finanzas en un espacio privado y a compartir las del hogar en un espacio separado, si lo necesitas.',
    hero: 'Reúne tus estados de cuenta y facturas para saber en qué gastas. Planea el próximo mes y organiza tu dinero para lo que más te importa.',
  },
};

export function getSiteContent(locale: SiteLocale): SiteCopy {
  return siteContent[locale];
}
