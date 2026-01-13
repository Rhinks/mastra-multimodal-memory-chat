import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
export const chatAgent = new Agent({
  name: "chat-agent",
  instructions: "You are a helpful assistant.",
  model: "openai/gpt-4o-mini",
  memory: new Memory({
    options: {
      lastMessages: 10,
    },
  }),
}); 

