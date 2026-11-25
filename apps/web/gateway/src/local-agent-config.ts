import { localWebOrigin } from '@nive/finance';

export function configuredLocalAgentOrigin(environment: NodeJS.ProcessEnv): string | undefined {
  if (environment['NODE_ENV'] === 'development' && environment['NIVE_LOCAL_AGENT'] === '1') {
    return localWebOrigin(environment['AUTH_ORIGIN']);
  }

  return undefined;
}
