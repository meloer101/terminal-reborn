import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import { initTheme } from './theme'
import { AppShell } from './app-shell/AppShell'
import { openTerminalMenu } from './attempts/terminal-menu'
import { takeRunStart } from './scripts/run-script'
import { handleTerminalLink, resolveSessionPaths } from './state/link-actions'
import { setTerminalHandlers } from './terminal/handlers'

initTheme()
setTerminalHandlers({
  link: handleTerminalLink,
  resolvePaths: resolveSessionPaths,
  contextMenu: (sessionId, at) => void openTerminalMenu(sessionId, at),
  takeRunStart
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
)
