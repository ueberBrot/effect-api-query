import { ActionButton } from "@effect-api-query/shared/ui/action-button.tsx";
import { EffectErrorDetails } from "@effect-api-query/shared/ui/effect-error-details.tsx";
import {
  describeSlowQueryCancellation,
  useSlowQueryCancellation,
} from "@effect-api-query/shared/use-slow-query-cancellation.ts";
import { useMutation } from "@tanstack/react-query";

import type { ViteReactApplication } from "../../lib/application.ts";

export const DiagnosticsSection = ({
  application,
}: {
  readonly application: ViteReactApplication;
}) => {
  const declaredFailure = useMutation(
    application.trackMutationOptions(
      application.rpcQuery.diagnostics.fail.mutationOptions({
        rpcOptions: { headers: { "x-request-source": "diagnostics-panel" } },
      })
    )
  );
  const slowQuery = useSlowQueryCancellation(application);
  const message = describeSlowQueryCancellation(slowQuery.state);

  return (
    <section className="border-border bg-card shadow-shadow/40 space-y-4 border p-6 shadow-2xl">
      <h2 className="display-heading text-foreground text-2xl font-bold">
        Failures and cancellation
      </h2>
      <p className="text-muted-foreground text-sm leading-6">
        Generated errors preserve their Effect causes. Cancelling the query
        interrupts its RPC Effect on the server.
      </p>
      <div className="flex flex-wrap gap-3">
        <ActionButton
          onClick={() => {
            declaredFailure.mutate();
          }}
          type="button"
          variant="danger"
        >
          Trigger declared failure
        </ActionButton>
        <ActionButton
          disabled={!slowQuery.canStart}
          onClick={() => {
            void slowQuery.start();
          }}
          type="button"
          variant="secondary"
        >
          Start slow query
        </ActionButton>
        <ActionButton
          disabled={!slowQuery.canCancel}
          onClick={() => {
            void slowQuery.cancel();
          }}
          type="button"
          variant="secondary"
        >
          Cancel query
        </ActionButton>
      </div>
      <EffectErrorDetails error={declaredFailure.error} />
      {slowQuery.state._tag === "Failed" ? (
        <EffectErrorDetails error={slowQuery.state.error} />
      ) : null}
      {message === undefined ? null : <p className="text-sm">{message}</p>}
    </section>
  );
};
