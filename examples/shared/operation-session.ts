import { operationSessionPath } from "@effect-api-query/contracts";

const renewAfterMs = 30 * 60 * 1000;

export const startOperationSession = async (
  rpcUrl: string
): Promise<typeof fetch> => {
  const { href, origin } = globalThis.location;
  const url = new URL(rpcUrl, href);
  if (url.origin !== origin) {
    return async (input, init) => await fetch(input, init);
  }

  let renewAt = 0;
  let pending: Promise<void> | undefined;
  const renew = async () => {
    if (Date.now() >= renewAt) {
      pending ??= navigator.locks
        .request("example-operation-session", async () => {
          const response = await fetch(new URL(operationSessionPath, url), {
            method: "POST",
            credentials: "same-origin",
          });
          if (!response.ok) {
            throw new Error("Could not start the example operation session");
          }
          renewAt = Date.now() + renewAfterMs;
        })
        .finally(() => {
          pending = undefined;
        });
      await pending;
    }
  };

  await renew();
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : input, href);
    if (target.origin === origin) {
      await renew();
    }
    return await fetch(input, init);
  };
};
