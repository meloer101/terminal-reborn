export interface MockRequest {
  tools: string[]
  input: Array<Record<string, unknown>>
  body: Record<string, unknown>
}

export interface MockProvider {
  port: number
  /** `-c` override values that point Codex at the mock for one launch. */
  config: string[]
  close(): Promise<void>
}

export function startMockProvider(options?: { onRequest?: (request: MockRequest) => void }): Promise<MockProvider>
