import { middleware } from 'astro:i18n';
import { defineMiddleware } from 'astro:middleware';

const localize = middleware({ prefixDefaultLocale: true, redirectToDefaultLocale: true, fallbackType: 'redirect' });

export const onRequest = defineMiddleware((context, next) => {
  // The original getting-started guide also has an unprefixed English URL.
  if (context.url.pathname === '/docs/' || context.url.pathname === '/docs') {
    return next();
  }

  return localize(context, next);
});
