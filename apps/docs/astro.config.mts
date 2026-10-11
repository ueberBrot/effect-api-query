import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightThemeBlack from 'starlight-theme-black'

import packageManifest from '../../package.json' with { type: 'json' }

const repositoryUrl = 'https://github.com/ueberBrot/effect-api-query'
const docsBase = '/effect-api-query'
const packageUrl = `https://www.npmjs.com/package/${packageManifest.name}`

export default defineConfig({
  base: docsBase,
  integrations: [
    starlight({
      description: 'Use Effect RPC and HttpApi with typed TanStack Query options and cache keys.',
      editLink: {
        baseUrl: `${repositoryUrl}/edit/main/apps/docs/`,
      },
      lastUpdated: true,
      head: [
        {
          tag: 'script',
          attrs: {
            defer: true,
            src: `${docsBase}/package-version.js`,
          },
        },
      ],
      logo: {
        src: './src/assets/icon.svg',
      },
      plugins: [
        starlightLlmsTxt(),
        starlightThemeBlack({
          navLinks: [
            {
              label: 'npm',
              link: packageUrl,
            },
          ],
        }),
        starlightLinksValidator({
          errorOnRelativeLinks: true,
        }),
      ],
      sidebar: [
        {
          label: 'Start Here',
          items: [
            {
              label: 'Installation',
              slug: 'getting-started/installation',
            },
            {
              label: 'Supported Operations',
              slug: 'getting-started/feature-support',
            },
          ],
        },
        {
          label: 'HTTP API',
          items: [
            {
              label: 'Quick Start',
              slug: 'getting-started/http-quick-start',
            },
            {
              label: 'Contract and Utility Tree',
              slug: 'concepts/http-utility-tree',
            },
            {
              label: 'Requests and Uploads',
              slug: 'guides/http-queries-and-mutations',
            },
            {
              label: 'Response Metadata',
              slug: 'guides/http-metadata',
            },
            {
              label: 'Factory',
              slug: 'reference/http-factory',
            },
            {
              label: 'Builders',
              slug: 'reference/http-builders',
            },
          ],
        },
        {
          label: 'RPC',
          items: [
            {
              label: 'Quick Start',
              slug: 'getting-started/quick-start',
            },
            {
              label: 'Contract and Utility Tree',
              slug: 'concepts/rpc-utility-tree',
            },
            {
              label: 'Factory',
              slug: 'reference/factory',
            },
            {
              label: 'Builders',
              slug: 'reference/generated-builders',
            },
          ],
        },
        {
          label: 'Library',
          items: [
            {
              label: 'Contracts and Inputs',
              items: [
                {
                  label: 'Generated Utility Model',
                  slug: 'concepts/queries-and-mutations',
                },
                {
                  label: 'Inputs and Query Data',
                  slug: 'concepts/data-normalization',
                },
              ],
            },
            {
              label: 'Options and Cache Views',
              items: [
                {
                  label: 'Queries',
                  slug: 'guides/queries',
                },
                {
                  label: 'Mutations',
                  slug: 'guides/mutations',
                },
                {
                  label: 'Pagination',
                  slug: 'guides/pagination',
                },
                {
                  label: 'Conditional Queries',
                  slug: 'guides/conditional-queries',
                },
                {
                  label: 'Streaming',
                  slug: 'guides/streaming',
                },
                {
                  label: 'Stream History',
                  slug: 'guides/choose-stream-history',
                },
              ],
              collapsed: true,
            },
            {
              label: 'Cache and Policies',
              items: [
                {
                  label: 'Semantic Keys',
                  slug: 'concepts/semantic-keys',
                },
                {
                  label: 'Cache Keys and Filters',
                  slug: 'guides/cache-filters',
                },
                {
                  label: 'Defaults and Policies',
                  slug: 'guides/query-defaults',
                },
                {
                  label: 'Custom Key Encoders',
                  slug: 'guides/custom-key-encoders',
                },
                {
                  label: 'Optimistic Updates',
                  slug: 'guides/optimistic-writes',
                },
                {
                  label: 'Refresh from Events',
                  slug: 'guides/refresh-from-events',
                },
                {
                  label: 'Switch Cache Owners',
                  slug: 'guides/switch-cache-owners',
                },
              ],
              collapsed: true,
            },
            {
              label: 'Execution and Lifetime',
              items: [
                {
                  label: 'Client Lifecycle',
                  slug: 'concepts/client-lifecycle',
                },
                {
                  label: 'Handle Failures',
                  slug: 'guides/handle-failures',
                },
                {
                  label: 'Retry Queries',
                  slug: 'guides/retry-queries',
                },
                {
                  label: 'Cancellation',
                  slug: 'guides/cancellation',
                },
              ],
              collapsed: true,
            },
          ],
        },
        {
          label: 'Integrations',
          items: [
            {
              label: 'Overview',
              slug: 'integrations',
            },
            {
              label: 'React',
              items: [
                {
                  label: 'Client Setup and Hooks',
                  slug: 'guides/react-query',
                },
                {
                  label: 'Suspense and Error Recovery',
                  slug: 'guides/suspense-and-recovery',
                },
              ],
            },
            {
              label: 'Reactive Frameworks',
              items: [
                {
                  label: 'Vue Query',
                  slug: 'guides/vue-query',
                },
                {
                  label: 'Solid Query',
                  slug: 'guides/solid-query',
                },
                {
                  label: 'Svelte Query',
                  slug: 'guides/svelte-query',
                },
                {
                  label: 'Angular Query',
                  slug: 'guides/angular-query',
                },
              ],
              collapsed: true,
            },
            {
              label: 'Router and Server Rendering',
              items: [
                {
                  label: 'Router and Start',
                  slug: 'guides/tanstack-start',
                },
                {
                  label: 'Hydrate Query Data',
                  slug: 'guides/hydrate-unary-data',
                },
                {
                  label: 'Hydrate Query Views',
                  slug: 'guides/hydrate-query-views',
                },
                {
                  label: 'Stream Snapshots',
                  slug: 'guides/stream-snapshots',
                },
              ],
              collapsed: true,
            },
            {
              label: 'Clients and Hosts',
              items: [
                {
                  label: 'WebSocket Clients',
                  slug: 'guides/websocket-clients',
                },
                {
                  label: 'Browser and Worker Hosts',
                  slug: 'reference/browser-and-worker-hosts',
                },
                {
                  label: 'Stream Tracing',
                  slug: 'guides/trace-streams',
                },
                {
                  label: 'External HTTP Clients',
                  slug: 'reference/external-http-clients',
                },
              ],
              collapsed: true,
            },
          ],
        },
        {
          label: 'Examples',
          items: [
            {
              label: 'Run the Applications',
              slug: 'examples',
            },
            {
              label: 'Cancellable Commands',
              slug: 'examples/cancellable-commands',
            },
          ],
          collapsed: true,
        },
        {
          label: 'API Reference',
          items: [
            {
              label: 'Type Inference',
              slug: 'reference/type-inference',
            },
            {
              label: 'Errors',
              slug: 'reference/errors',
            },
            {
              label: 'Public Exports',
              slug: 'reference/public-exports',
            },
            {
              label: 'Compatibility and Limits',
              slug: 'reference/compatibility-and-limits',
            },
            {
              label: 'Compatibility and Stability',
              slug: 'getting-started/compatibility-and-stability',
            },
            {
              label: 'Performance and Bundling',
              slug: 'reference/performance',
            },
          ],
          collapsed: true,
        },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: repositoryUrl }],
      title: packageManifest.name,
    }),
  ],
  site: 'https://ueberbrot.github.io',
})
