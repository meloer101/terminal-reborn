// Wavi's permission extension for a Pi GUI session (`pi --mode rpc -e <this file>`, never installed into ~/.pi; PRD F23
// v1.158). Pi has no approval dialogs of its own; like T3 Code's extension (provider-pi mcpExtensionSource.ts @ 6417151)
// it gates tool calls with `ctx.ui.confirm`, which rpc mode sends to Wavi as an `extension_ui_request`. Unlike T3
// Code's, it asks for every call that is not read-only and leaves the decision to Wavi's driver
// (src/main/gui/pi-rpc.ts), so a change of 询问 / 接受编辑 needs no restart. The message is JSON Wavi recognises.
// Event shapes: @earendil-works/pi-coding-agent core/extensions/types (0.84.1).

const READ_ONLY = new Set(['read', 'grep', 'find', 'ls'])

export default function (pi) {
  pi.on('tool_call', async (event, ctx) => {
    if (READ_ONLY.has(event.toolName)) return undefined
    const approved = await ctx.ui.confirm(`Allow ${event.toolName}?`, JSON.stringify({ wavi: 1, tool: event.toolName, input: event.input ?? null }), { signal: ctx.signal })
    return approved ? undefined : { block: true, reason: `${event.toolName} was declined in Wavi.` }
  })
}
