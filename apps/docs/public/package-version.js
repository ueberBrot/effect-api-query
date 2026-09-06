;(() => {
  const packageUrl = 'https://www.npmjs.com/package/effect-api-query'
  const packageManifestUrl = 'https://registry.npmjs.org/effect-api-query/latest'
  const semanticVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

  const updatePackageVersion = (version) => {
    const label = `v${version}`

    for (const link of document.querySelectorAll(`a[href="${packageUrl}"]`)) {
      link.textContent = label
      link.setAttribute('aria-label', `effect-api-query ${label} on npm`)
    }
  }

  const loadPackageVersion = async () => {
    try {
      const response = await fetch(packageManifestUrl, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return

      const manifest = await response.json()
      if (typeof manifest.version !== 'string' || !semanticVersion.test(manifest.version)) return

      updatePackageVersion(manifest.version)
    } catch {
      // Keep the version embedded by the last documentation build.
    }
  }

  void loadPackageVersion()
})()
