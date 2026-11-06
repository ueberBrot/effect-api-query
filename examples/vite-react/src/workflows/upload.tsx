import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { ActionButton } from "../components/ui/action-button.tsx";
import { EffectErrorDetails } from "../components/ui/effect-error-details.tsx";
import type { HttpWorkflows } from "./application.ts";

export const UploadExample = ({
  application,
}: {
  readonly application: HttpWorkflows;
}) => {
  const mutation = useMutation(
    application.http.uploads.upload.mutationOptions()
  );
  const [validation, setValidation] = useState<string>();
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = new FormData(event.currentTarget);
    const file = payload.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > 65_536) {
      setValidation("Choose a nonempty file up to 64 KiB.");
      return;
    }
    setValidation(undefined);
    mutation.mutate({ payload });
  };
  return (
    <section className="grid gap-4">
      <p>
        Send explicit FormData through a mutation. The server also enforces the
        64 KiB file limit and releases its temporary file after the request.
      </p>
      <form className="grid gap-4" onSubmit={submit}>
        <label className="grid gap-1">
          Upload title
          <input
            className="border-border bg-background border p-2"
            name="title"
            required
            defaultValue="Release attachment"
          />
        </label>
        <label className="grid gap-1">
          Attachment
          <input name="file" type="file" required />
        </label>
        <ActionButton type="submit" disabled={mutation.isPending}>
          Upload attachment
        </ActionButton>
      </form>
      {validation === undefined ? null : <p role="alert">{validation}</p>}
      {mutation.isPending ? <output>Uploading…</output> : null}
      {mutation.data === undefined ? null : (
        <output>
          Received {mutation.data.fileName}: {String(mutation.data.bytes)} bytes
        </output>
      )}
      <EffectErrorDetails error={mutation.error} />
    </section>
  );
};
