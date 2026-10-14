// Renderer side of workspace persistence (phase 2 · A12): reads the main-owned store once at startup,
// migrates the old localStorage data on first run, and sends snapshots back to be saved.
// Main debounces and writes atomically; this file only decides *what* to send and *when*.
import { createDraftStore, type DraftStore } from '../composer/drafts'
import {
  LEGACY_DRAFTS_KEY,
  LEGACY_WORKSPACE_KEY,
  migrateLegacyWorkspace,
  sanitizeWorkspaceFile,
  type WorkspaceFile
} from '@shared/workspace-file'

// End-to-end fixture runs (`__TR_E2E__`) never read or write the saved workspace.
const fixtures = (globalThis as { __TR_E2E__?: boolean }).__TR_E2E__ === true

function store() {
  if (fixtures) return null
  return (globalThis as { window?: Window }).window?.tr?.workspace ?? null
}

function localStorageOrNull(): Pick<Storage, 'getItem' | 'removeItem'> | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readLegacy(): WorkspaceFile | null {
  const storage = localStorageOrNull()
  if (!storage) return null
  try {
    return migrateLegacyWorkspace(storage.getItem(LEGACY_WORKSPACE_KEY), storage.getItem(LEGACY_DRAFTS_KEY), Date.now())
  } catch {
    return null
  }
}

function dropLegacy(): void {
  const storage = localStorageOrNull()
  try {
    storage?.removeItem(LEGACY_WORKSPACE_KEY)
    storage?.removeItem(LEGACY_DRAFTS_KEY)
  } catch {
    // Nothing to clean up.
  }
}

let initial: { file: WorkspaceFile | null } | undefined

/**
 * The saved workspace for this run (null on a fresh start). First run only: if main has no file yet, the
 * pre-2a localStorage data is migrated and handed to main. The old keys are removed on a *later* start,
 * once the new file is known to exist, so a crash right after migrating loses nothing.
 */
export function initialWorkspaceFile(): WorkspaceFile | null {
  if (initial) return initial.file
  const api = store()
  let file: WorkspaceFile | null = null
  if (api) {
    file = sanitizeWorkspaceFile(api.loadSync(), Date.now())
    if (file) {
      dropLegacy()
    } else {
      file = readLegacy()
      if (file) api.save(file)
    }
  }
  initial = { file }
  return file
}

let snapshot: (() => WorkspaceFile) | null = null

/** The workspace store registers how to build a snapshot; saving needs both its state and the drafts. */
export function setSnapshotProvider(provider: () => WorkspaceFile): void {
  snapshot = provider
}

/** Sends the current workspace to main to be saved (main coalesces). A no-op in fixture runs. */
export function requestSave(): void {
  const api = store()
  if (api && snapshot) api.save(snapshot())
}

/** Composer drafts, loaded with the workspace and saved with it. */
export const drafts: DraftStore = createDraftStore(initialWorkspaceFile()?.drafts ?? {}, requestSave)
