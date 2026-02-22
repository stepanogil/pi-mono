import { getModel } from "@mariozechner/pi-ai/src/index.ts";
import { Agent } from "./packages/agent/src/index.ts";

// AZURE_OPENAI_API_KEY and AZURE_OPENAI_BASE_URL are picked up automatically
// Replace "gpt-4o" with whatever model is deployed on your Azure endpoint
const model = getModel("azure-openai-responses", "gpt-4.1");

const agent = new Agent({
	initialState: {
		systemPrompt: "You are a helpful assistant. Keep responses concise.",
		model,
		thinkingLevel: "off",
		tools: [],
	},
});

// Stream output as it arrives
agent.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
	if (event.type === "agent_end") {
		console.log("\n\n--- done ---");
	}
});

await agent.prompt("What is 2 + 2?");
