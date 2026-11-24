import { spanishHelpCopy } from './help-copy.es';
import type { SiteLocale } from './site';

export type HelpCopy = {
  title: string;
  description: string;
  availability: string;
  back: string;
  home: string;
  open: string;
  topics: { title: string; body: string }[];
};

const englishHelpCopy: HelpCopy = {
  title: 'A good place to start.',
  description: 'Bring your history together, make a plan and keep your personal space your own.',
  availability:
    'You can create an account and explore the example dashboard today. The steps below describe planned features.',
  back: 'Back to Nive',
  home: 'Home',
  open: 'Open the app',
  topics: [
    {
      title: 'Create your private space',
      body: 'Open Nive and create your vault: a private space for your accounts, budgets and transactions. You can start without creating a family.',
    },
    {
      title: 'Keep your recovery key safe',
      body: 'Your recovery key unlocks your financial data. Save a copy somewhere safe before continuing. If you lose it, resetting your account password will not restore access to that data.',
    },
    {
      title: 'Add your accounts',
      body: 'Add your cash, bank accounts and credit cards. Enter each starting balance and its date so your history begins with the right amount.',
    },
    {
      title: 'Bring in your documents',
      body: 'Import a bank CSV or CFDI 4.0 XML invoice. Review entries that need your attention. Nive does not connect to your bank, and PDF files are not supported.',
    },
    {
      title: 'Plan your spending',
      body: 'Review a suggested budget or create your own. Adjust the amounts and approve the plan when you are ready. A budget does not move money or change account balances.',
    },
    {
      title: 'Save a draft or record a transaction',
      body: 'Save a draft when you want to finish later. Drafts do not change balances. Record the transaction when it is ready to update your accounts and spending history.',
    },
    {
      title: 'Correct a mistake',
      body: 'Open a transaction in the ledger to correct it, reverse it or record a refund. Nive keeps the original entry so you can see what changed.',
    },
    {
      title: 'Keep family finances separate',
      body: 'Create a separate space for household bills and shopping lists. Family membership does not grant access to your personal accounts. Share selected information only when you choose.',
    },
  ],
};

export function getHelpCopy(locale: SiteLocale): HelpCopy {
  return locale === 'es' ? spanishHelpCopy : englishHelpCopy;
}
