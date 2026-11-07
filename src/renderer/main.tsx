import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import { initTheme } from './theme'
import { AppShell } from './app-shell/AppShell'
import { openTerminalMenu } from './attempts/terminal-menu'
import { installedAgents } from './new-session/sheet-store'
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
// 在此新建会话 lists the installed agents at once: ask now, so even the first right-click does not wait for a login shell.
void installedAgents()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
)
