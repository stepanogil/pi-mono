Here's a thorough walkthrough of `packages/agent/`. It's a small but carefully designed package - just 5 source files - that sits between the raw LLM API layer (`packages/ai`) and the application layer (`packages/coding-agent`).

---

## The Big Picture

The package's job: **maintain conversation state and run a "think > act > loop" cycle.**

It has two main concepts:
- **`Agent` class** (`agent.ts`) - the stateful object you hold onto. Manages message history, tools, model config, and event subscriptions.
- **`agentLoop` function** (`agent-loop.ts`) - the functional, stateless loop that does the actual work turn-by-turn.

---

## File by File

### 1. `types.ts` - The Type Vocabulary

This file defines every important type in the package. A few are worth understanding deeply:

**`AgentMessage`**
```ts
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```
`Message` is the plain LLM type from `pi-ai` (user/assistant/toolResult). `AgentMessage` extends it by using **declaration merging** - apps can add custom message types (like `notification` or `artifact`) that live in the conversation array but are **invisible to the LLM**. The `convertToLlm` function filters them out before each API call.

`Insight`
- **Declaration merging on interfaces** (the `CustomAgentMessages` pattern) is a TypeScript feature that lets packages extend a type at compile time without modifying the original library. `packages/coding-agent` uses this to add session-specific message types like `BranchSummaryEntry`.
- **`AgentMessage` is deliberately wider than `Message`** - this separation lets the agent hold UI-only messages (status indicators, file diffs) without poisoning the conversation history sent to the LLM.
`---`

**`AgentLoopConfig`**
The configuration passed to each loop run. Three functions define how the loop transforms messages before each LLM call:
- `convertToLlm(messages)` - filters/converts `AgentMessage[]` ΓåÆ LLM-compatible `Message[]` (required)
- `transformContext(messages)` - prunes or injects before `convertToLlm` (optional, e.g. compaction)
- `getSteeringMessages()` - called after each tool to check if the user interrupted mid-run
- `getFollowUpMessages()` - called when the agent would stop, to check if there are queued tasks

**`AgentEvent`** - a union of all observable lifecycle moments:
```
agent_start / agent_end
turn_start / turn_end
message_start / message_update / message_end
tool_execution_start / tool_execution_update / tool_execution_end
```
The TUI and session layers subscribe to these to render the UI and persist the conversation.

---

### 2. `agent-loop.ts` - The Core Loop (Functional)

This is the real engine. It's a pure-ish async function that knows nothing about state - it takes context in, emits events, and returns new messages.

**Entry points:**
- `agentLoop(prompts, context, config, signal, streamFn)` - start a new turn with user prompt(s)
- `agentLoopContinue(context, config, signal, streamFn)` - resume from existing context (e.g. retries)

Both return an `EventStream<AgentEvent, AgentMessage[]>` - an async iterable that yields events as they happen, and resolves to the full list of new messages when done.

**`runLoop()` - the heart of the package**

```
outer while(true):         ΓåÉ continues while follow-up messages arrive
  inner while(hasToolCalls || pendingMessages):   ΓåÉ one LLM turn per iteration
    inject pending steering messages
    streamAssistantResponse()   ΓåÉ call LLM, stream response
    if error/abort ΓåÆ stop
    executeToolCalls()          ΓåÉ run tools in sequence
    check for steering messages after tools
  check for follow-up messages
  if none ΓåÆ break
```

`Insight`
- The **dual-loop structure** (outer/inner) handles a subtle timing problem: a user might type a follow-up while the agent is still running tools. The inner loop handles mid-run interruptions (steering), while the outer loop handles "the agent finished, but now there's a queued message to process next".
- **Steering vs. follow-up** is a meaningful distinction: steering messages *interrupt* the current sequence (skip remaining tool calls), while follow-up messages *wait* until the agent is completely idle. This maps to intuitive UX - "stop what you're doing" vs. "after you're done, also do this".
`---`

**`streamAssistantResponse()`** - where the type transformation happens:
```
AgentMessage[] 
  ΓåÆ transformContext()     (prune/inject at AgentMessage level)
  ΓåÆ convertToLlm()         (filter to LLM-compatible Message[])
  ΓåÆ streamFn()             (actual HTTP call to provider)
  ΓåÆ emit message_update events as chunks arrive
```

**`executeToolCalls()`** - runs tool calls *sequentially* (not in parallel) and checks for steering after each one. If the user sends a steering message mid-tool-execution, remaining tool calls are marked as skipped with a `"Skipped due to queued user message."` result.

---

### 3. `agent.ts` - The Stateful Agent Class

This wraps `agentLoop` with state management. It's what application code actually holds onto.

**Key state (`AgentState`):**
```ts
{
  systemPrompt, model, thinkingLevel, tools,
  messages: AgentMessage[],    // the conversation history
  isStreaming: boolean,
  streamMessage: AgentMessage | null,   // the currently-streaming partial message
  pendingToolCalls: Set<string>,
}
```

**Event system:**
```ts
subscribe(fn: (e: AgentEvent) => void): () => void
```
Returns an unsubscribe function - the standard pattern for event subscriptions that need cleanup.

**Message flow through `prompt()`:**
1. Validates `isStreaming` is false (no concurrent calls)
2. Normalizes input (string ΓåÆ `UserMessage`, `AgentMessage[]` passthrough)
3. Calls `_runLoop()`, which:
   - Creates an `AbortController`
   - Calls `agentLoop()` or `agentLoopContinue()`
   - Iterates the event stream, updating `_state` and emitting to subscribers
4. Error path: wraps any thrown error as an assistant message with `stopReason: "error"`

**The two message queues:**

```ts
steer(m: AgentMessage)      // interrupt current run after next tool
followUp(m: AgentMessage)   // add to queue for after agent is idle
```
These feed `getSteeringMessages`/`getFollowUpMessages` callbacks in the loop config. The `steeringMode`/`followUpMode` options control whether queued messages are delivered one-at-a-time or all at once.

`Insight`
- **`runningPrompt: Promise<void>`** with `waitForIdle()` is a clever coordination primitive. It lets external code `await agent.waitForIdle()` to know when the agent finishes - without polling or exposing internal async internals. It's a deferred promise pattern: the promise is created at loop start and resolved in `finally`.
- The `pendingToolCalls: Set<string>` stored as a **new `Set` on every modification** (not mutating in place) is intentional. Any UI framework doing reference equality checks (like React or the custom TUI) will correctly detect changes because the reference changes each time.
`---`

---

### 4. `proxy.ts` - Alternate Transport for Server-Proxied Calls

This is an optional drop-in replacement for the default `streamFn`. Instead of calling LLM providers directly, it posts to `/api/stream` on a proxy server.

The server sends a leaner event format (`ProxyAssistantMessageEvent`) that omits the `partial` field from delta events to save bandwidth. The client reconstructs the growing partial message locally in `processProxyEvent()` by mutating a single `partial: AssistantMessage` object and attaching it to each event before emitting.

Usage:
```ts
const agent = new Agent({
  streamFn: (model, context, options) =>
    streamProxy(model, context, { ...options, authToken, proxyUrl }),
});
```

---

## The Full Message Journey (Annotated)

```
agent.prompt("fix the bug in foo.ts")
  Γöé
  Γö£ΓöÇ Creates UserMessage { role: "user", content: [...] }
  Γö£ΓöÇ Pushes to context.messages
  Γöé
  ΓööΓöÇ agentLoop() starts
       Γöé
       Γö£ΓöÇ TURN 1: streamAssistantResponse()
       Γöé    Γö£ΓöÇ transformContext()   ΓåÉ compaction hook (coding-agent adds this)
       Γöé    Γö£ΓöÇ convertToLlm()      ΓåÉ filter custom messages
       Γöé    ΓööΓöÇ streamSimple()      ΓåÉ HTTP SSE call to Azure OpenAI
       Γöé         ΓåÆ emits: message_start, message_update├ùN, message_end
       Γöé
       Γö£ΓöÇ LLM responds with toolCall: { name: "bash", args: { cmd: "..." } }
       Γöé
       Γö£ΓöÇ executeToolCalls()
       Γöé    Γö£ΓöÇ validateToolArguments()
       Γöé    Γö£ΓöÇ tool.execute(...)    ΓåÉ actual bash execution
       Γöé    Γö£ΓöÇ emits: tool_execution_start, tool_execution_end
       Γöé    ΓööΓöÇ pushes ToolResultMessage to context
       Γöé
       Γö£ΓöÇ TURN 2: streamAssistantResponse()  ΓåÉ loops back with tool result
       Γöé    ΓööΓöÇ LLM responds with text (no more tool calls)
       Γöé
       ΓööΓöÇ agent_end emitted, loop exits
```

---

## Summary: What Each File Owns

| File | Role |
|---|---|
| `types.ts` | All shared types - `AgentMessage`, `AgentLoopConfig`, `AgentEvent`, `AgentTool` |
| `agent-loop.ts` | Stateless loop logic - streaming, tool execution, steering/follow-up handling |
| `agent.ts` | Stateful wrapper - holds `messages[]`, config, event subscriptions, queues |
| `proxy.ts` | Alternate stream transport for server-proxied deployments |
| `index.ts` | Re-exports everything as the package's public API |