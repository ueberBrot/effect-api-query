export const openOperationSession = async (
  origin: string,
  send: (request: Request) => Promise<Response> = fetch,
  cookie?: string
) => {
  const headers = new Headers({ origin });
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }
  const response = await send(
    new Request(`${origin}/api/demo-operations`, {
      method: "POST",
      headers,
    })
  );
  const session = response.headers.get("set-cookie")?.split(";")[0];
  if (response.status !== 204 || session === undefined) {
    throw new Error("Expected an operation session");
  }
  const sessionFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    request.headers.set("origin", origin);
    request.headers.set("cookie", session);
    return await send(request);
  };
  const request = (path: string, init?: RequestInit) => {
    const input = new Request(`${origin}${path}`, init);
    input.headers.set("cookie", session);
    input.headers.set("origin", origin);
    return input;
  };
  return { cookie: session, fetch: sessionFetch, request };
};
