1. when user 'logs in', user is subscribe to agent events
2. user sends prompts e.g. 'hello'
3. Agent.prompt method handles the message as AgentMessage:
    Agent:
    - LLM to use
    - runs internal methold _runloop with list of AgentMessage
    _runLoop:
    sets context:
        - sets system message
        - create a copy of AgentMessage list
        - sets tools the LLM can use
    sets variables to use in a single loop via AgentLoopConfig
        - which LLM
        - reasoning config
        etc
        add callbacks:
            e.g. convertToLLM - clean up AgentMessage list to define the elements that will be sent to LLM
    pass the messages, context, config to the agent loop
    wait for events emitting from agent loop, pass the events to frontend/user via this.emit(event);
        - updates AgentState via:
        switch (event.type) {
					case "message_start":
						partial = event.message;
						this._state.streamMessage = event.message;
						break;

					case "message_update":
						partial = event.message;
						this._state.streamMessage = event.message;
						break;

					case "message_end":
						partial = null;
						this._state.streamMessage = null;
						this.appendMessage(event.message);
						break;

					case "tool_execution_start": {
						const s = new Set(this._state.pendingToolCalls);
						s.add(event.toolCallId);
						this._state.pendingToolCalls = s;
						break;
					}

					case "tool_execution_end": {
						const s = new Set(this._state.pendingToolCalls);
						s.delete(event.toolCallId);
						this._state.pendingToolCalls = s;
						break;
					}

					case "turn_end":
						if (event.message.role === "assistant" && (event.message as any).errorMessage) {
							this._state.error = (event.message as any).errorMessage;
						}
						break;

					case "agent_end":
						this._state.isStreaming = false;
						this._state.streamMessage = null;
						break;
				}





    