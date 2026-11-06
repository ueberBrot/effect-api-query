import type { Document } from "@effect-api-query/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  configureUtils,
  createBranchQueryFilter,
  findDeclaredError,
  isEffectHttpApiQueryError,
} from "@ueberbrot/effect-api-query";
import { Option } from "effect";
import { useMemo, useState } from "react";
import type { SubmitEvent } from "react";

import { ActionButton } from "../components/ui/action-button.tsx";
import { EffectErrorDetails } from "../components/ui/effect-error-details.tsx";
import type { HttpWorkflows } from "./application.ts";

const DocumentEditor = ({
  application,
  document,
  etag,
}: {
  readonly application: HttpWorkflows;
  readonly document: Document;
  readonly etag: string;
}) => {
  const [title, setTitle] = useState("");
  const [staleEtag, setStaleEtag] = useState<string>();
  const write = useMemo(
    () =>
      configureUtils(application.http.documents.write, {
        mutation: {
          policy: {
            onSuccess: async () => {
              await application.queryClient.invalidateQueries({
                queryKey: application.http.documents.read.key(),
              });
            },
          },
        },
      }),
    [application]
  );
  const mutation = useMutation(write.mutationOptions());
  const rejected = isEffectHttpApiQueryError(mutation.error)
    ? findDeclaredError(mutation.error, "TitleRejected")
    : Option.none();
  const conflict = isEffectHttpApiQueryError(mutation.error)
    ? findDeclaredError(mutation.error, "RevisionConflict")
    : Option.none();
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate({ headers: { "if-match": etag }, payload: { title } });
  };
  return (
    <div className="mt-5 grid gap-4">
      <p>Current title: {document.title}</p>
      <p>Revision: {String(document.revision)}</p>
      <form className="grid gap-3" onSubmit={submit}>
        <label className="grid gap-1">
          Document title
          <input
            className="border-border bg-background border p-2"
            value={title}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
            }}
            required
          />
        </label>
        <p>Try a title containing “blocked” to see a declared field error.</p>
        <ActionButton type="submit" disabled={mutation.isPending}>
          Save title
        </ActionButton>
      </form>
      <div className="flex flex-wrap gap-3">
        <ActionButton
          variant="secondary"
          onClick={() => {
            setStaleEtag(etag);
          }}
        >
          Remember this revision
        </ActionButton>
        <ActionButton
          variant="secondary"
          disabled={staleEtag === undefined || mutation.isPending}
          onClick={() => {
            if (staleEtag !== undefined) {
              mutation.mutate({
                headers: { "if-match": staleEtag },
                payload: { title: "Write from an older revision" },
              });
            }
          }}
        >
          Try remembered revision
        </ActionButton>
      </div>
      {mutation.isPending ? <output>Saving…</output> : null}
      {mutation.isSuccess ? <output>Saved {mutation.data.title}</output> : null}
      {Option.isSome(rejected) ? (
        <p role="alert">{rejected.value.message}</p>
      ) : null}
      {Option.isSome(conflict) ? (
        <p role="alert">
          The document changed. Read the latest revision before saving again.
        </p>
      ) : null}
      {Option.isNone(rejected) && Option.isNone(conflict) ? (
        <EffectErrorDetails error={mutation.error} />
      ) : null}
    </div>
  );
};

export const DocumentExample = ({
  application,
}: {
  readonly application: HttpWorkflows;
}) => {
  const { http, queryClient } = application;
  const document = useQuery(http.documents.read.metadataOptions());
  const metadataReads = useMemo(
    () => createBranchQueryFilter(http.documents, "metadata"),
    [http]
  );
  return (
    <section className="grid gap-4">
      <p>
        Read the decoded document and its response metadata. A write carries the
        quoted ETag, and the server rejects an outdated revision.
      </p>
      {document.data === undefined ? (
        <p>Loading document…</p>
      ) : (
        <>
          <p>HTTP status: {String(document.data.status)}</p>
          <p>ETag: {document.data.headers["etag"]}</p>
          {document.data.headers["etag"] === undefined ? (
            <p role="alert">The server supplied no ETag.</p>
          ) : (
            <DocumentEditor
              application={application}
              document={document.data.data}
              etag={document.data.headers["etag"]}
            />
          )}
        </>
      )}
      <ActionButton
        variant="secondary"
        disabled={document.isFetching}
        onClick={() => {
          void queryClient.invalidateQueries(metadataReads());
        }}
      >
        Refresh metadata views
      </ActionButton>
      <EffectErrorDetails error={document.error} />
    </section>
  );
};

export const MinimalExample = ({
  application,
}: {
  readonly application: HttpWorkflows;
}) => {
  const document = useQuery(application.http.documents.read.metadataOptions());
  const mutation = useMutation(
    application.http.documents.write.mutationOptions({
      onSuccess: async (saved) => {
        application.queryClient.setQueryData(
          application.http.documents.read.queryKey(),
          saved
        );
        await application.queryClient.invalidateQueries({
          queryKey: application.http.documents.read.metadataKey(),
          exact: true,
        });
      },
    })
  );
  return (
    <section className="grid gap-4">
      <p>
        One ready HTTP client, one QueryClient, generated options, and a native
        provider. The application drains accepted work before disposing the
        runtime.
      </p>
      <p>Current title: {document.data?.data.title ?? "Loading…"}</p>
      <ActionButton
        disabled={
          document.data?.headers["etag"] === undefined || mutation.isPending
        }
        onClick={() => {
          if (document.data?.headers["etag"] !== undefined) {
            mutation.mutate({
              headers: {
                "if-match": document.data.headers["etag"],
              },
              payload: { title: "My first typed write" },
            });
          }
        }}
      >
        Write and seed the cache
      </ActionButton>
      <EffectErrorDetails error={document.error ?? mutation.error} />
      {mutation.isSuccess ? (
        <output>The mutation response updated the exact query key.</output>
      ) : null}
    </section>
  );
};
