import { spanishMarketingCopy } from './marketing-copy.es';
import type { SiteLocale } from './site';

export type MarketingCopy = {
  skip: string;
  home: string;
  navigationLabel: string;
  navigation: string[];
  signIn: string;
  start: string;
  explore: string;
  heroNote: string;
  availability: string;
  preview: {
    label: string;
    space: string;
    period: string;
    remaining: string;
    planned: string;
    spent: string;
    categories: string[];
  };
  product: { eyebrow: string; title: string; body: string; cards: { title: string; body: string; tag: string }[] };
  steps: { eyebrow: string; title: string; items: { title: string; body: string }[] };
  privacy: { eyebrow: string; title: string; body: string; recovery: string; recoveryBody: string; link: string };
  family: { eyebrow: string; title: string; body: string; points: string[] };
  faq: { title: string; items: { question: string; answer: string }[] };
  closing: { title: string; body: string };
  footer: { line: string; help: string; note: string };
};

const englishMarketingCopy: MarketingCopy = {
  skip: 'Skip to content',
  home: 'Home',
  navigationLabel: 'Main navigation',
  navigation: ['Your money', 'How it works', 'Your privacy'],
  signIn: 'Sign in',
  start: 'Get started',
  explore: 'See how it works',
  heroNote: 'Start for yourself. Share only when you choose.',
  availability: 'Budgeting, imports and family spaces are still in development.',
  preview: {
    label: 'Illustrative example · MXN',
    space: 'My space',
    period: 'This month',
    remaining: 'Left in the plan',
    planned: 'Planned',
    spent: 'Spent',
    categories: ['Groceries', 'Home', 'A little for you'],
  },
  product: {
    eyebrow: 'Less keeping track. More perspective.',
    title: 'Make room for real life.',
    body: 'Your money has a story. Bring the pieces together, see where you stand and make a plan that fits.',
    cards: [
      {
        title: 'Your history, in one place.',
        body: 'Bring in bank CSV files and CFDI 4.0 invoices. Review what needs your attention, without entering every purchase by hand.',
        tag: 'Start with your documents',
      },
      {
        title: 'A plan you can understand.',
        body: 'Use your history to prepare a budget. See the reasons, adjust the amounts and decide what to keep.',
        tag: 'You have the final say',
      },
      {
        title: 'Small purchases. Bigger picture.',
        body: 'Keep shopping lists alongside your budget. Separate estimates from what you actually spend.',
        tag: 'Plan before you spend',
      },
    ],
  },
  steps: {
    eyebrow: 'A simpler starting point',
    title: 'From scattered files to a next step.',
    items: [
      { title: 'Create your private space.', body: 'Set up your vault and save your recovery key somewhere safe.' },
      {
        title: 'Bring your history.',
        body: 'Upload a bank CSV or CFDI 4.0 XML file. Check any entries that need a decision.',
      },
      {
        title: 'Find your own rhythm.',
        body: 'Review a budget, follow your spending and use what you learn to plan the next period.',
      },
    ],
  },
  privacy: {
    eyebrow: 'Personal means personal',
    title: 'Your money.\nYour space.',
    body: 'Your personal accounts stay separate from your household. Joining a family does not give anyone access to your personal financial history.',
    recovery: 'A key worth keeping.',
    recoveryBody:
      'Your recovery key opens your financial data. Save a copy somewhere safe. If you lose it, resetting your account password will not restore access to that data.',
    link: 'Read the getting-started guide',
  },
  family: {
    eyebrow: 'Life is shared. Not everything has to be.',
    title: 'A little more together.',
    body: 'Give household plans a place of their own. Coordinate purchases and contributions without mixing them with your personal accounts.',
    points: [
      'Separate personal and family spaces',
      'Shared shopping lists and household bills',
      'Clear contributions and recorded spending',
    ],
  },
  faq: {
    title: 'Good questions. Clear answers.',
    items: [
      {
        question: 'Do I need to create a family?',
        answer:
          'No. Start with your own private vault. A separate family space is optional, and you can create one when you want to coordinate household finances.',
      },
      {
        question: 'Can Nive connect to my bank?',
        answer:
          'Nive does not connect to your bank or move money. The planned options are importing a bank CSV file or a CFDI 4.0 XML invoice and recording a transaction yourself. PDF imports are not supported.',
      },
      {
        question: 'Will a suggested budget change my balances?',
        answer:
          'No. A proposed budget is a plan for you to review and approve. Estimates and drafts are separate from recorded transactions.',
      },
      {
        question: 'What if I lose my recovery key?',
        answer:
          'Keep a safe copy before you start. If you lose the key, changing your account password will not restore access to the financial data protected by it.',
      },
    ],
  },
  closing: { title: 'A clearer view.\nA calmer next step.', body: 'Make a little space for your money today.' },
  footer: {
    line: 'A place for your money. Room for your life.',
    help: 'Getting started',
    note: 'Nive helps you organize and plan. It does not hold or move your money.',
  },
};

export function getMarketingCopy(locale: SiteLocale): MarketingCopy {
  return locale === 'es' ? spanishMarketingCopy : englishMarketingCopy;
}
