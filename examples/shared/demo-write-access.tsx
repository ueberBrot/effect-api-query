import { useId, useRef, useState } from "react";

export const DemoWriteAccess = () => {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  return (
    <details className="text-sm">
      <summary>Demo write access</summary>
      <form
        action="/api/demo-access"
        method="post"
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const token = input.current?.value;
          if (token === undefined || token === "") {
            return;
          }
          form.reset();
          if (!globalThis.isSecureContext) {
            setStatus("Open the demo on HTTPS or loopback to enable writes.");
            return;
          }
          setStatus("");
          void (async () => {
            try {
              const response = await fetch("/api/demo-access", {
                method: "POST",
                headers: { authorization: `Bearer ${token}` },
              });
              setStatus(
                response.ok
                  ? "Write access enabled for one hour."
                  : "Write access denied."
              );
            } catch {
              setStatus("Could not enable write access.");
            }
          })();
        }}
      >
        <p>Use the server’s EXAMPLE_WRITE_TOKEN.</p>
        <label htmlFor={inputId}>Write token</label>
        <input id={inputId} ref={input} type="password" required />
        <button type="submit">Enable writes</button>
        <output aria-label="Write access">{status}</output>
      </form>
    </details>
  );
};
