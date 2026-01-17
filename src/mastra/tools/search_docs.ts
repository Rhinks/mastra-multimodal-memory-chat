// query chromadb for semantic search in docs
// + query neo4j for knowledge graph entities

import { generateEmbeddings } from "../../services/embeddings";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchDocuments } from "../../services/vectorStore";

export const searchDocs = createTool({
  id: "search-docs",
  description: "Search user documents using semantic search. Always call rewrite-query first to optimize the search query.",
  inputSchema: z.object({
    query: z.string().describe("The search query string (preferably rewritten for better results)"),
  }),
  
  execute: async (params) => {
      const query = params.context.query;

      const runtimeContext = params.runtimeContext;
      const username = runtimeContext?.get?.('username') as string;
      

      console.log('\n========================================');
      console.log('🔍 SEARCH-DOCS TOOL CALLED!');
      console.log('========================================');
      console.log('🔍 Username:', username);
      console.log('🔍 Query (for embedding):', query)
      
      try {
        const embedding = await generateEmbeddings(query);
        console.log('🔍 Generated embedding vector of length:', embedding.length);
        const results = await searchDocuments(username, embedding, 5);
        console.log('🔍 Search results found:', results.count);
        
        if (!results.data || results.data.length === 0) {
          console.log('🔍 No results found for this query');
          return `No documents found matching: "${query}". Try a different query or check if documents have been uploaded.`;
        }
        
        return results;
      } catch (error) {
        console.error('🔍 Search error:', error);
        return `Error searching documents: ${error}`;
      }
}});


