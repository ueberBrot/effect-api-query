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
              label: `v${packageManifest.version}`,
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
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'RPC Quick Start', slug: 'getting-started/quick-start' },
            { label: 'HTTP Quick Start', slug: 'getting-started/http-quick-start' },
            { label: 'Feature Support', slug: 'getting-started/feature-support' },
            {
              label: 'Compatibility and Stability',
              slug: 'getting-started/compatibility-and-stability',
            },
          ],
        },
        {
          label: 'Functionality',
          items: [
            { label: 'Queries', slug: 'guides/queries' },
            { label: 'Mutations', slug: 'guides/mutations' },
            { label: 'Pagination', slug: 'guides/pagination' },
            { label: 'Streaming', slug: 'guides/streaming' },
            { label: 'HTTP Metadata', slug: 'guides/http-metadata' },
            { label: 'HTTP Requests and Uploads', slug: 'guides/http-queries-and-mutations' },
            { label: 'Conditional Queries', slug: 'guides/conditional-queries' },
            { label: 'Cache Management', slug: 'guides/cache-management' },
            { label: 'Cache Filters', slug: 'guides/cache-filters' },
            { label: 'Query Defaults', slug: 'guides/query-defaults' },
            { label: 'Choose Stream History', slug: 'guides/choose-stream-history' },
            { label: 'Handle Failures', slug: 'guides/handle-failures' },
            { label: 'Retry Queries', slug: 'guides/retry-queries' },
            { label: 'Cancellation', slug: 'guides/cancellation' },
            { label: 'Custom Key Encoders', slug: 'guides/custom-key-encoders' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'React Query', slug: 'guides/react-query' },
            { label: 'Vue Query', slug: 'guides/vue-query' },
            { label: 'Solid Query', slug: 'guides/solid-query' },
            { label: 'Svelte Query', slug: 'guides/svelte-query' },
            { label: 'Angular Query', slug: 'guides/angular-query' },
            { label: 'TanStack Start', slug: 'guides/tanstack-start' },
            { label: 'WebSocket Ready Clients', slug: 'guides/websocket-clients' },
            { label: 'Browser and Worker Hosts', slug: 'reference/browser-and-worker-hosts' },
            { label: 'External HTTP Clients', slug: 'reference/external-http-clients' },
          ],
        },
        {
          label: 'Recipes',
          items: [
            { label: 'Switch Cache Owners', slug: 'guides/switch-cache-owners' },
            { label: 'Optimistic User Writes', slug: 'guides/optimistic-writes' },
            { label: 'Refresh from Domain Events', slug: 'guides/refresh-from-events' },
            { label: 'Stream Snapshots', slug: 'guides/stream-snapshots' },
            { label: 'Hydrate Unary Data', slug: 'guides/hydrate-unary-data' },
            { label: 'Hydrate Query Views', slug: 'guides/hydrate-query-views' },
            { label: 'Executable Examples', slug: 'examples' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'RPC Utility Tree', slug: 'concepts/rpc-utility-tree' },
            { label: 'HTTP Utility Tree', slug: 'concepts/http-utility-tree' },
            { label: 'Queries and Mutations', slug: 'concepts/queries-and-mutations' },
            { label: 'Client Lifecycle', slug: 'concepts/client-lifecycle' },
            { label: 'Semantic Keys', slug: 'concepts/semantic-keys' },
            { label: 'Data Normalization', slug: 'concepts/data-normalization' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'RPC Factory', slug: 'reference/factory' },
            { label: 'HTTP Factory', slug: 'reference/http-factory' },
            { label: 'RPC Builders', slug: 'reference/generated-builders' },
            { label: 'HTTP Builders', slug: 'reference/http-builders' },
            { label: 'Errors', slug: 'reference/errors' },
            { label: 'Public Exports', slug: 'reference/public-exports' },
            { label: 'Performance and Bundling', slug: 'reference/performance' },
            { label: 'Compatibility and Limits', slug: 'reference/compatibility-and-limits' },
          ],
        },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: repositoryUrl }],
      title: packageManifest.name,
    }),
  ],
  site: 'https://ueberbrot.github.io',
})
