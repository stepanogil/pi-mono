# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## User Context

The user’s goal is to **understand and explore** the codebase, not to extend, modify, or build new features. Tailor explanations to an intermediate-level JavaScript/TypeScript/Node.js developer. Prioritize clear, thorough explanations that explain how and why things work over brief or highly condensed answers. Avoid assuming advanced expertise, but do not oversimplify core concepts.

---

## What This Repo Is

**pi-mono** is an npm workspaces monorepo for building AI coding agents. Its main product is `pi-coding-agent` — an interactive CLI agent (similar to Claude Code itself) that uses multiple LLM providers. The repo is a real-world example of a multi-provider AI agent with streaming, tool execution, session management, and an extension system.

---

## LLM Provider in Use

This repo is being explored with **Azure OpenAI** as the LLM backend. The following environment variables must be set in the shell before running the coding agent or any LLM-dependent tests:

```
AZURE_OPENAI_API_KEY=934aa*********************
AZURE_OPENAI_RESOURCE_NAME=jgs-migo-4o-openai-dev
```

These are already set in the user's shell environment. Do not hardcode or echo these values.

---

## Commands

All commands are run from the repo root unless noted.

```bash
# Build all packages (in dependency order)
npm run build

# Run all tests (skips LLM tests without API keys)
npm test
# or use the helper script:
./test.sh

# Lint + type-check (requires a prior build)
npm run check

# Watch mode for development
npm run dev

# Clean all build artifacts
npm run clean
```

To run tests for a **single package**:
```bash
cd packages/ai && npx vitest run
cd packages/agent && npx vitest run
```

Build order matters: `tui → ai → agent → coding-agent → mom → web-ui → pods`. Running `npm run build` at the root handles this automatically.

---

## Package Overview

| Package | Purpose |
|---|---|
| `packages/ai` | Unified API over 20+ LLM providers (Anthropic, OpenAI, Gemini, Bedrock, Mistral, etc.) |
| `packages/agent` | Stateful agent runtime: tool execution, streaming, event hooks |
| `packages/coding-agent` | Interactive CLI coding agent — the main product |
| `packages/tui` | Custom terminal UI framework with differential rendering |
| `packages/mom` | Slack bot that wraps the coding agent |
| `packages/web-ui` | Web components for chat interfaces |
| `packages/pods` | CLI for managing vLLM deployments |

---

## Architecture: How the Layers Fit Together

Understanding the repo requires seeing how these three layers interact:

### 1. `packages/ai` — Foundation

Provides a **single unified interface** for all LLM providers. Every provider (OpenAI, Anthropic, Google, AWS Bedrock, etc.) is wrapped into the same `stream()` / `complete()` API. Key concepts:

- **Model registry**: `models.generated.ts` lists every supported model with pricing and capability metadata. This file is auto-generated.
- **Tool definitions**: Tools are defined using [TypeBox](https://github.com/sinclairzx81/typebox) schemas, which produce both the JSON Schema sent to the LLM and runtime validation.
- **Streaming events**: A unified `AssistantMessageEventStream` emits `text_delta`, `toolcall_delta`, `thinking_delta`, etc., regardless of provider.
- **Thinking/reasoning**: Abstracted via a `reasoning` level (`'low' | 'medium' | 'high'` etc.) — maps to provider-specific params under the hood.

### 2. `packages/agent` — Runtime

Wraps `pi-ai` with **stateful agent loop** logic:

- Maintains a `messages[]` array (the conversation context).
- On each turn: sends messages → streams response → executes any tool calls → appends results → loops until no more tool calls.
- Exposes an **event system**: listeners can hook into `before_tool_call`, `after_tool_call`, `message`, etc.
- `AgentMessage[]` is the internal type; a `transformContext()` step filters/converts these to the plain `Message[]` type that `pi-ai` understands before each API call.

### 3. `packages/coding-agent` — Application

Adds everything needed for a real interactive coding agent on top of `pi-agent-core`:

- **Four built-in tools**: `read`, `write`, `edit`, `bash`
- **Session persistence**: Conversations saved as JSON-L files with typed entries (`SessionMessageEntry`, `ModelChangeEntry`, `BranchSummaryEntry`, etc.)
- **Compaction**: Automatically summarises old context when approaching model token limits.
- **Extension system**: Custom tools, hooks, skills (YAML-based), and themes can be plugged in via npm packages.

### Message Flow (simplified)

```
User input
  → AgentMessage[] (app-level, can include custom types)
  → transformContext() (prune/inject)
  → convertToLlm() (filter to LLM-compatible types only)
  → provider adapter (Anthropic/OpenAI/etc. specific format)
  → API call + streaming response
  → tool execution (if any) → loop
```

---

## Key Files to Read When Exploring

| File | Why it's interesting |
|---|---|
| `packages/ai/src/index.ts` | Public API surface of the unified LLM layer |
| `packages/ai/src/models.generated.ts` | All supported models with metadata |
| `packages/agent/src/agent.ts` | The core agent loop |
| `packages/coding-agent/src/tools/` | The four built-in tools (read/write/edit/bash) |
| `packages/coding-agent/src/session.ts` | Session persistence format |
| `packages/tui/src/` | Custom terminal UI — interesting differential rendering approach |
| `AGENTS.md` | Rules and architecture notes written for AI agents operating in this repo |
| `packages/ai/README.md` | Very detailed — covers every provider, auth, tools, thinking levels |
| `packages/coding-agent/README.md` | Covers CLI modes, extension system, skills, themes |

---

## TypeScript Patterns Used in This Codebase

- **TypeBox** for schema-first type definitions (used extensively for tool parameters)
- **Declaration merging** on `AgentMessage` to allow packages to add custom message types
- Strict mode enabled — no implicit `any`
- ES2022 target with Node.js module resolution
- Build output goes to each package's `dist/` folder
