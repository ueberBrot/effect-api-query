export const startOperationSession = async (rpcUrl: string): Promise<void> => {
  const url = new URL(rpcUrl, globalThis.location.href);
  if (url.origin !== globalThis.location.origin) {
    return;
  }
  const issue = async () => {
    const response = await fetch(new URL("/api/demo-operations", url), {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error("Could not start the example operation session");
    }
  };
  await navigator.locks.request("example-operation-session", issue);
};
