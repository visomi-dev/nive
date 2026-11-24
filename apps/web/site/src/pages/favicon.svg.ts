import type { APIRoute } from 'astro';

// Vite emits the shared brand asset at the same URL used by the website layout.
// eslint-disable-next-line @nx/enforce-module-boundaries
import favicon from '../../../../../assets/brand/favicon.svg?url';

export const GET: APIRoute = ({ redirect }) => redirect(favicon, 302);
