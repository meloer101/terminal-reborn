// Entry for the Electron utilityProcess that owns all node-pty instances.
// Implemented by the `pty-terminal` track (docs/tasks/m1-pty-terminal.md).

process.parentPort?.on('message', () => {
  // Placeholder: spawn / write / resize / kill messages from main land here.
})
