/// <mls fileReference="_102034_/l2/shared/bff-client.ts" enhancement="_blank" />
export async function execBff<TData = unknown>(   
  routine: string,
  params: unknown,
): Promise<{
  ok: boolean;
  data: TData | null;
  error: { code: string; message: string; details?: unknown } | null;
}> {
  const response = await fetch('/execBff', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      routine,
      params,
      meta: {
        source: 'http',
      },
    }),
  });

  return response.json();
}
