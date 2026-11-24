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
    hero: 'See which payments are covered, how much is left and what carries into your next budget period. Use what happened this period to plan the next.',
  },
  es: {
    eyebrow: 'Entiende mejor tu dinero',
    title: 'Tus finanzas, más claras. Tu vida cambia.',
    description:
      'Nive te ayuda a organizar tus finanzas en un espacio privado y a compartir las del hogar en un espacio separado, si lo necesitas.',
    hero: 'Consulta qué pagos están cubiertos, cuánto queda y qué saldo pasa al próximo periodo. Usa lo que pasó en este periodo para planear el siguiente.',
  },
};

export function getSiteContent(locale: SiteLocale): SiteCopy {
  return siteContent[locale];
}
