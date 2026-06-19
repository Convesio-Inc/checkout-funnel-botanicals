import { json } from '../common';

export async function handleConfig(env: Env): Promise<Response> {
  return json(
    {
      apiKey: env.CPAY_API_KEY,
      environment: env.CPAY_ENVIRONMENT ?? 'test',
    },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
