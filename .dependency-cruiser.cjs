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
      name: 'shared-is-portable',
      severity: 'error',
      comment: 'src/shared runs in the renderer too: no node built-ins, no Electron.',
      from: { path: '^src/shared/' },
      to: { dependencyTypes: ['core'] }
    },
    {
      name: 'renderer-through-window-tr',
      severity: 'error',
      comment: 'The renderer reaches the system only through window.tr: no main, preload or host code.',
      from: { path: '^src/renderer/' },
      to: { path: '^src/(main|preload|pty-host|pty-daemon)/' }
    },
    {
      name: 'renderer-has-no-node',
      severity: 'error',
      comment: 'The renderer is sandboxed: node built-ins and Electron are reached through window.tr only.',
      from: { path: '^src/renderer/' },
      to: { dependencyTypes: ['core'] }
    },
    {
      name: 'no-electron-outside-main',
      severity: 'error',
      comment: 'Electron is loaded by main and preload only: the renderer, src/shared and the pty processes never.',
      from: { path: '^src/(shared|renderer|pty-host|pty-daemon)/' },
      to: { path: '(^|/)node_modules/electron/' }
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
      name: 'usage-stats-stands-alone',
      severity: 'error',
      comment:
        'The 额度 statistics scanner runs in a worker thread: it reads only through its own sources and src/shared. index.ts is its one Electron glue file.',
      from: { path: '^src/main/usage-stats/', pathNot: '^src/main/usage-stats/index\\.ts$' },
      to: { path: ['^src/(?!shared/|main/usage-stats/)', '(^|/)node_modules/electron/'] }
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
        'The daemon outlives the app and never loads Electron. It imports two main modules that need only node and ' +
        'src/shared (the snapshot files, with the id and size checks they use, and the hook socket server).',
      from: { path: '^src/pty-daemon/' },
      to: { path: '^src/(main|renderer|preload)/', pathNot: '^src/main/(terminal-snapshot-file|hooks/server)\\.ts$' }
    },
    {
      name: 'pty-daemon-never-loads-electron',
      severity: 'error',
      comment: 'Not even through the main modules it shares (the direct-import rule above cannot see that far).',
      from: { path: '^src/pty-daemon/' },
      to: { path: '(^|/)node_modules/electron/', reachable: true }
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
