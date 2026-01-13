// query chromadb for semantic search in docs
// + query neo4j for knowledge graph entities


import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const searchDocs = createTool({
  id: "search-docs",
  description: "Search documents using semantic search and knowledge graph entities",
  inputSchema: z.object({
    query: z.string().describe("The search query string"),
  }),
  //placeholder implementation
});