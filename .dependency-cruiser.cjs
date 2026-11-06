// Dependency rules of CLAUDE.md "Layout and ownership", checked by `npm run lint:deps` (part of `npm run check`).
// Rules go by folder, so a new feature folder needs no change here. Tests are left out: they may reach across.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A runtime import cycle (type-only imports do not count): one side reads the other half-initialised.',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'], viaOnly: { dependencyTypesNot: ['type-only'] } }
    },
    {
      name: 'shared-is-pure',
      severity: 'error',
      comment: 'src/shared is the typed contract and logic main and the renderer share: it depends on nothing else here.',
      from: { path: '^src/shared/' },
      to: { path: '^src/(?!shared/)' }
    },
    {
      name: 'renderer-through-window-tr',
      severity: 'error',
      comment: 'The renderer reaches the system only through window.tr: no main, preload or host code.',
      from: { path: '^src/renderer/' },
      to: { path: '^src/(main|preload|pty-host|pty-daemon)/' }
    },
    {
      name: 'preload-is-transport',
      severity: 'error',
      from: { path: '^src/preload/' },
      to: { path: '^src/(main|renderer|pty-host|pty-daemon)/' }
    },
    {
      name: 'main-has-no-ui',
      severity: 'error',
      from: { path: '^src/main/' },
      to: { path: '^src/(renderer|preload)/' }
    },
    {
      name: 'pty-host-stands-alone',
      severity: 'error',
      comment: 'The pty-host runs as its own process (utilityProcess / inside the daemon): no Electron main code.',
      from: { path: '^src/pty-host/' },
      to: { path: '^src/(main|renderer|preload|pty-daemon)/' }
    },
    {
      name: 'pty-daemon-stands-alone',
      severity: 'error',
      comment:
        'The daemon outlives the app and never loads Electron. It shares two main modules that need only node and ' +
        'src/shared: the snapshot files and the hook socket server.',
      from: { path: '^src/pty-daemon/' },
      to: { path: '^src/(main|renderer|preload)/', pathNot: '^src/main/(terminal-snapshot-file|hooks/server)\\.ts$' }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.tsx?$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.web.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'] }
  }
}
