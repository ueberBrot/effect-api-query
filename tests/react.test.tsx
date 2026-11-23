// @vitest-environment jsdom

import { QueryClient } from "@tanstack/query-core";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { Activity, StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { acquireQueryOwner } from "#effect-api-query";
import type { QueryOwner } from "#effect-api-query";
import {
  createQueryUtilsContext,
  QueryOwnerProvider,
  useQueryOwner,
} from "#effect-api-query/react";

interface TestUtils {
  readonly label: string;
}

const makeBorrowedOwner = async (label: string) =>
  await acquireQueryOwner(
    async (setup) => await Promise.resolve(setup.borrow({ label }))
  );

const MissingOwner = () => {
  useQueryOwner();
  return null;
};

describe("@ueberbrot/effect-api-query/react", () => {
  afterEach(() => {
    cleanup();
  });

  it("provides utils, owner, and a keyed QueryClient in owner mode", async () => {
    const { Provider, useQueryUtils } = createQueryUtilsContext<TestUtils>({
      displayName: "TestQueryUtils",
    });
    const owner = await makeBorrowedOwner("owner-a");
    let observedClient: QueryClient | undefined;
    let observedOwner: QueryOwner<unknown> | undefined;
    let observedUtils: TestUtils | undefined;

    const Reader = () => {
      const utils = useQueryUtils();
      const currentOwner = useQueryOwner();
      const client = useQueryClient();
      useEffect(() => {
        observedUtils = utils;
        observedOwner = currentOwner;
        observedClient = client;
      }, [client, currentOwner, utils]);
      return <span>{utils.label}</span>;
    };

    try {
      render(
        <Provider owner={owner}>
          <Reader />
        </Provider>
      );

      expect(screen.getByText("owner-a")).toBeDefined();
      expect({
        observedClient,
        observedOwner,
        observedUtils,
      }).toStrictEqual({
        observedClient: owner.queryClient,
        observedOwner: owner,
        observedUtils: owner.resources,
      });
    } finally {
      await owner.dispose();
    }
  });

  it("supports provideQueryClient={false} for outer QueryClientProvider hosts", async () => {
    const { Provider, useQueryUtils } = createQueryUtilsContext<TestUtils>();
    const outerClient = new QueryClient();
    const owner = await makeBorrowedOwner("delegated");
    let observedClient: QueryClient | undefined;
    let observedOwner: QueryOwner<unknown> | undefined;

    const Reader = () => {
      const utils = useQueryUtils();
      const currentOwner = useQueryOwner();
      const client = useQueryClient();
      useEffect(() => {
        observedOwner = currentOwner;
        observedClient = client;
      }, [client, currentOwner]);
      return <span>{utils.label}</span>;
    };

    try {
      render(
        <QueryClientProvider client={outerClient}>
          <Provider owner={owner} provideQueryClient={false}>
            <Reader />
          </Provider>
        </QueryClientProvider>
      );

      expect(screen.getByText("delegated")).toBeDefined();
      expect(observedOwner).toBe(owner);
      expect(observedClient).toBe(outerClient);
      expect(observedClient).not.toBe(owner.queryClient);
    } finally {
      outerClient.clear();
      await owner.dispose();
    }
  });

  it("provides utils with and without an explicit QueryClient in utils mode", () => {
    const { Provider, useQueryUtils } = createQueryUtilsContext<TestUtils>();
    const outerClient = new QueryClient();
    const innerClient = new QueryClient();
    const utils: TestUtils = { label: "plain-utils" };
    let observedClient: QueryClient | undefined;

    const Reader = () => {
      const read = useQueryUtils();
      const client = useQueryClient();
      useEffect(() => {
        observedClient = client;
      }, [client]);
      return <span>{read.label}</span>;
    };

    try {
      const view = render(
        <QueryClientProvider client={outerClient}>
          <Provider utils={utils}>
            <Reader />
          </Provider>
        </QueryClientProvider>
      );
      expect(screen.getByText("plain-utils")).toBeDefined();
      expect(observedClient).toBe(outerClient);

      view.rerender(
        <QueryClientProvider client={outerClient}>
          <Provider client={innerClient} utils={utils}>
            <Reader />
          </Provider>
        </QueryClientProvider>
      );
      expect(observedClient).toBe(innerClient);
    } finally {
      outerClient.clear();
      innerClient.clear();
    }
  });

  it("provides QueryOwner standalone via QueryOwnerProvider", async () => {
    const outerClient = new QueryClient();
    const owner = await makeBorrowedOwner("standalone");
    let observedOwner: QueryOwner<unknown> | undefined;
    let observedClient: QueryClient | undefined;

    const Reader = () => {
      const currentOwner = useQueryOwner();
      const client = useQueryClient();
      useEffect(() => {
        observedOwner = currentOwner;
        observedClient = client;
      }, [client, currentOwner]);
      return <span>ok</span>;
    };

    try {
      const view = render(
        <QueryOwnerProvider owner={owner}>
          <Reader />
        </QueryOwnerProvider>
      );
      expect({ observedClient, observedOwner }).toStrictEqual({
        observedClient: owner.queryClient,
        observedOwner: owner,
      });

      view.rerender(
        <QueryClientProvider client={outerClient}>
          <QueryOwnerProvider owner={owner} provideQueryClient={false}>
            <Reader />
          </QueryOwnerProvider>
        </QueryClientProvider>
      );
      expect({ observedClient, observedOwner }).toStrictEqual({
        observedClient: outerClient,
        observedOwner: owner,
      });
    } finally {
      outerClient.clear();
      await owner.dispose();
    }
  });

  it("throws clear errors when hooks are used outside their providers", () => {
    const named = createQueryUtilsContext<TestUtils>({
      displayName: "BillingUtils",
    });
    const unnamed = createQueryUtilsContext<TestUtils>();

    const MissingNamedUtils = () => {
      named.useQueryUtils();
      return null;
    };

    const MissingUnnamedUtils = () => {
      unnamed.useQueryUtils();
      return null;
    };

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      expect(() => render(<MissingNamedUtils />)).toThrow(/BillingUtils/u);
      expect(() => render(<MissingUnnamedUtils />)).toThrow(/Provider/u);
      expect(() => render(<MissingOwner />)).toThrow(/QueryOwnerProvider/u);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("remounts observers deterministically when owner swaps and preserves them on unchanged re-renders", async () => {
    const { Provider, useQueryUtils } = createQueryUtilsContext<TestUtils>();
    const firstOwner = await makeBorrowedOwner("first");
    const secondOwner = await makeBorrowedOwner("second");
    firstOwner.queryClient.setQueryData(["greeting"], "hello-first");
    secondOwner.queryClient.setQueryData(["greeting"], "hello-second");

    let mountCount = 0;
    let unmountCount = 0;

    const Observer = ({ tick }: { readonly tick: number }) => {
      const utils = useQueryUtils();
      const query = useQuery<string>({
        queryKey: ["greeting"],
        queryFn: () => "unexpected",
        staleTime: Number.POSITIVE_INFINITY,
      });

      useEffect(() => {
        mountCount += 1;
        return () => {
          unmountCount += 1;
        };
      }, []);

      return <div>{`${utils.label}:${query.data ?? "empty"}:t${tick}`}</div>;
    };

    try {
      const view = render(
        <Provider owner={firstOwner}>
          <Observer tick={1} />
        </Provider>
      );
      expect({
        mountCount,
        text: screen.getByText("first:hello-first:t1").textContent,
        unmountCount,
      }).toStrictEqual({
        mountCount: 1,
        text: "first:hello-first:t1",
        unmountCount: 0,
      });

      view.rerender(
        <Provider owner={firstOwner}>
          <Observer tick={2} />
        </Provider>
      );
      expect({
        mountCount,
        text: screen.getByText("first:hello-first:t2").textContent,
        unmountCount,
      }).toStrictEqual({
        mountCount: 1,
        text: "first:hello-first:t2",
        unmountCount: 0,
      });

      view.rerender(
        <Provider owner={secondOwner}>
          <Observer tick={3} />
        </Provider>
      );
      expect({
        mountCount,
        text: screen.getByText("second:hello-second:t3").textContent,
        unmountCount,
      }).toStrictEqual({
        mountCount: 2,
        text: "second:hello-second:t3",
        unmountCount: 1,
      });
    } finally {
      await firstOwner.dispose();
      await secondOwner.dispose();
    }
  });

  it("remounts observers when client swaps in utils mode and preserves them on unchanged client", () => {
    const { Provider } = createQueryUtilsContext<TestUtils>();
    const clientA = new QueryClient();
    const clientB = new QueryClient();
    const utils: TestUtils = { label: "utils" };
    let mounts = 0;
    let unmounts = 0;

    const Probe = ({ tick }: { readonly tick: number }) => {
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return <span>{`t${tick}`}</span>;
    };

    try {
      const view = render(
        <Provider client={clientA} utils={utils}>
          <Probe tick={1} />
        </Provider>
      );
      expect({
        mounts,
        text: screen.getByText("t1").textContent,
        unmounts,
      }).toStrictEqual({ mounts: 1, text: "t1", unmounts: 0 });

      view.rerender(
        <Provider client={clientA} utils={utils}>
          <Probe tick={2} />
        </Provider>
      );
      expect({
        mounts,
        text: screen.getByText("t2").textContent,
        unmounts,
      }).toStrictEqual({ mounts: 1, text: "t2", unmounts: 0 });

      view.rerender(
        <Provider client={clientB} utils={utils}>
          <Probe tick={3} />
        </Provider>
      );
      expect({
        mounts,
        text: screen.getByText("t3").textContent,
        unmounts,
      }).toStrictEqual({ mounts: 2, text: "t3", unmounts: 1 });
    } finally {
      clientA.clear();
      clientB.clear();
    }
  });

  it("stays lifecycle-neutral under React 19 StrictMode and Activity hiding", async () => {
    const { Provider, useQueryUtils } = createQueryUtilsContext<TestUtils>();
    const release = vi.fn<() => void>();
    const owner = await acquireQueryOwner(async (setup) => {
      await setup.acquire(() => "resource", release);
      return { label: "strict" };
    });

    const Child = () => {
      const utils = useQueryUtils();
      const currentOwner = useQueryOwner();
      return <span>{`${utils.label}:${currentOwner.isActive()}`}</span>;
    };

    try {
      const view = render(
        <StrictMode>
          <Activity mode="visible">
            <Provider owner={owner}>
              <Child />
            </Provider>
          </Activity>
        </StrictMode>
      );
      expect({
        active: owner.isActive(),
        releaseCalls: release.mock.calls.length,
        text: screen.getByText("strict:true").textContent,
      }).toStrictEqual({
        active: true,
        releaseCalls: 0,
        text: "strict:true",
      });

      view.rerender(
        <StrictMode>
          <Activity mode="hidden">
            <Provider owner={owner}>
              <Child />
            </Provider>
          </Activity>
        </StrictMode>
      );
      expect({
        active: owner.isActive(),
        releaseCalls: release.mock.calls.length,
      }).toStrictEqual({
        active: true,
        releaseCalls: 0,
      });

      view.unmount();
      expect({
        active: owner.isActive(),
        releaseCalls: release.mock.calls.length,
      }).toStrictEqual({
        active: true,
        releaseCalls: 0,
      });
    } finally {
      await owner.dispose();
    }
    expect(release).toHaveBeenCalledOnce();
  });

  it("renders gracefully when an outgoing owner retires mid-transition", async () => {
    const { Provider, useQueryUtils } = createQueryUtilsContext<TestUtils>();
    const outgoing = await makeBorrowedOwner("outgoing");
    const incoming = await makeBorrowedOwner("incoming");

    const Status = () => {
      const utils = useQueryUtils();
      const currentOwner = useQueryOwner();
      return <span>{`${utils.label}:${currentOwner.isActive()}`}</span>;
    };

    try {
      const view = render(
        <Provider owner={outgoing}>
          <Status />
        </Provider>
      );
      expect(screen.getByText("outgoing:true")).toBeDefined();

      await outgoing.dispose();

      view.rerender(
        <Provider owner={outgoing}>
          <Status />
        </Provider>
      );
      expect(screen.getByText("outgoing:false")).toBeDefined();

      view.rerender(
        <Provider owner={incoming}>
          <Status />
        </Provider>
      );
      expect(screen.getByText("incoming:true")).toBeDefined();
    } finally {
      await outgoing.dispose();
      await incoming.dispose();
    }
  });
});
