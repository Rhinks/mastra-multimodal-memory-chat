// query chromadb for semantic search in docs
// + query neo4j for knowledge graph entities

import { generateEmbeddings } from "../../services/embeddings";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchDocuments } from "../../services/vectorStore";

export const searchDocs = createTool({
  id: "search-docs",
  description: "Search documents using semantic search and knowledge graph entities",
  inputSchema: z.object({
    query: z.string().describe("The search query string"),
  }),
  
  execute: async (params) => {
      const query = params.context.query;

      const runtimeContext = params.runtimeContext;
      const username = runtimeContext?.get?.('username') as string;
      

      console.log('\n========================================');
      console.log('🔍 SEARCH-DOCS TOOL CALLED!');
      console.log('========================================');
      console.log('🔍 Username:', username);
      console.log('🔍 Query:', query)
      
      const embedding = await generateEmbeddings(query);
      console.log('🔍 Generated embedding vector of length:', embedding.length);
      const results = await searchDocuments(username, embedding, 5);
      console.log('🔍 Search results found:', results.count);
      return results;
}});


