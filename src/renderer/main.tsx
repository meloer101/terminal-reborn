import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import { initTheme } from './theme'
import { AppShell } from './app-shell/AppShell'
import { SettingsApp } from './settings/SettingsApp'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.hash === '#settings' ? <SettingsApp /> : <AppShell />}
  </StrictMode>
)
