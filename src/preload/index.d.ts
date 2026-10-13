import type { TrApi } from '../shared/ipc'

declare global {
  interface Window {
    tr: TrApi
  }
}

export {}
