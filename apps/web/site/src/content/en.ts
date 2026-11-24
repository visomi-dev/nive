export const en = {
  nav: {
    home: 'Overview',
    architecture: 'Architecture',
    docs: 'Documentation',
    ui: 'Components',
    foundations: 'Design foundations',
  },
  start: 'Setup guide',
  openApp: 'Open Nive',
  menu: 'Navigation',
  language: 'Language',
  theme: 'Appearance',
  themeToggle: 'Dark theme',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  skip: 'Skip to content',
  source: 'Source code',
  backTop: 'Back to top',
  footerBody: 'Nive is a workspace for personal finances, built on the open Visomi Stack foundation.',
  footerExplore: 'Explore Nive',
  footerBuild: 'Setup and source code',
  repoDocs: 'Repository guides',
  apiGuide: 'API and authentication guide',
  architecture: {
    title: 'How Nive works',
    description: 'See how the website, app, and API run together, and what’s planned.',
    eyebrow: 'ARCHITECTURE',
    intro:
      'The Express gateway serves the website, app, and API. Business rules stay in the part of the stack that owns them.',
    diagramTitle: 'How requests are routed',
    current: 'Available today',
    direction: 'Planned work',
    gatewayNote: 'Serves the website, Angular app, and API. Starts and closes shared services.',
    map: [
      ['Website', 'Astro SSR', '/en/ · /es/'],
      ['API', 'Express', '/api/'],
      ['Application', 'Angular SSR', '/app/en/ · /app/es/'],
    ],
    implementedTitle: 'What’s available now',
    implemented: [
      [
        'Public website',
        'Astro renders the site through the Express gateway, including localized routes, public assets and the component catalog.',
      ],
      [
        'Application foundation',
        'Angular SSR shares the gateway with the website and API, with localized builds, Signal Forms examples and a responsive shell.',
      ],
      [
        'Identity backend',
        'The API includes passkeys, account verification, recovery and PostgreSQL-backed sessions used by the Angular authentication screens.',
      ],
      [
        'Shared UI',
        'Typed visual recipes power native Angular and Astro adapters. Each framework owns its composition and interaction.',
      ],
    ],
    directionTitle: 'What’s planned',
    directionIntro: 'These plans describe future work.',
    future: [
      [
        'Background execution',
        'Give scheduled and long-running work a dedicated worker, with handlers owned by the relevant business capability.',
      ],
      [
        'Realtime delivery',
        'Keep connection authorization and event delivery separate from HTTP requests and background execution.',
      ],
      [
        'Client-protected data',
        'Explore client-owned keys and encrypted envelopes. Security assumptions, recovery and production guarantees need explicit design and review.',
      ],
    ],
    principlesTitle: 'How the code is organized',
    principles: [
      [
        'Organize code by domain',
        'Organize business capabilities around their domain. Keep genuinely cross-cutting concerns shared.',
      ],
      [
        'The executable owns startup',
        'Importing an application does not open a port. The owning executable starts and closes process resources.',
      ],
      [
        'Tests run through Nx',
        'Nx targets, unit suites and browser checks verify behavior alongside the implementation.',
      ],
    ],
    nextTitle: 'Read the code and guides',
    nextBody: 'Run Nive locally, then use the repository guides to find out how the parts fit together.',
  },
  docs: {
    title: 'Run Nive locally',
    description:
      'Get Nive running locally with Node, pnpm and Nx. Explore the Astro website, Angular application, shared UI and Express gateway.',
    eyebrow: 'SETUP GUIDE',
    intro: 'Run the website or app locally. You can explore the public pages before setting up authentication.',
    requirements: 'Before you start',
    requirementsBody: 'Use the versions listed in the repository. You need access to clone it.',
    stepOne: 'Clone the repository',
    stepOneBody: 'Clone the repository, open its folder, and install the pinned dependencies.',
    stepTwo: 'Choose what to run',
    stepTwoBody: 'Run a command in your terminal, then open its local address while it’s running.',
    entries: [
      [
        'Public website',
        'Astro development server. Start here for the website and UI catalog.',
        'pnpm nx serve web-site',
        'http://127.0.0.1:4200/en/',
      ],
      [
        'Angular app',
        'Angular SSR development server, running independently.',
        'pnpm nx serve web-app',
        'http://localhost:4201/app/en/',
      ],
      [
        'Express gateway',
        'Builds and mounts the compiled Astro site and Express API.',
        'pnpm nx serve web-gateway',
        'http://localhost:3000/en/',
      ],
    ],
    authNoteTitle: 'Set up authentication',
    authNoteBody:
      'Authentication needs PostgreSQL, secrets, and provider settings. The public site works without them. Sign-in stays unavailable until authentication is configured.',
    stepThree: 'Find files in the repository',
    stepThreeBody: 'Each app has its own entry point. The shared libraries contain code used by more than one app.',
    structure:
      'apps/web/site/        Astro website\napps/web/app/         Angular application\napps/web/api/         Express API\napps/web/gateway/     HTTP composition\nlibs/web/frontend/ui/ Shared visual recipes',
    checksTitle: 'Run the checks',
    checksBody:
      'Run the Nx checks for the part you changed. The website browser tests use the compiled site through Express.',
    nextTitle: 'Related guides',
    nextItems: [
      ['architecture', 'Understand the architecture', 'How the parts run together and what’s planned.'],
      ['ui', 'Explore the component catalog', 'Live examples with Angular, Astro and shared recipe usage.'],
      ['foundations', 'Review the visual foundations', 'Typography, surfaces, colors and light/dark themes.'],
    ],
  },
} as const;
