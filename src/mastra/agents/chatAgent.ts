import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

//import all the tools you want to use in the agent
import { retrieveRecentConversation } from "../tools/retrieve_recent_conversation";
import { searchDocs } from "../tools/search_docs";
import { queryKnowledgeGraphTool } from "../tools/query_kg";

//define the agent with tools and memory
export const chatAgent = new Agent({
  name: "chatAgent",
  instructions: 'You are a helpful assistant with access to conversation history. ' +
  'IMPORTANT: When a user asks about previous conversations, past sessions, what they talked about before, or references earlier discussions, you MUST use the retrieve-recent-conversation tool to fetch their conversation history. ' +
  'Always check conversation history when the user mentions "last time", "before", "yesterday", "previous session", or similar temporal references. ' +
  'Use the search-docs tool to find information in documents and the query-knowledge-graph tool for structured data queries. ' +
  'Engage in friendly and informative conversations.', 
  model: "openai/gpt-4o-mini",
  memory: new Memory({
    options: {
      lastMessages: 10,
    },
  }),
  tools: [
    retrieveRecentConversation,
    searchDocs,
    queryKnowledgeGraphTool,
  ],
}); 

