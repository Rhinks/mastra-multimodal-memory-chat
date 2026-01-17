import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const rewriteQuery = createTool({
  id: "rewrite-query",
  description: "Rewrite a user query to improve semantic search results in documents. Always call this before search-docs.",
  inputSchema: z.object({
    query: z.string().describe("The original user query that needs to be rewritten for better semantic search"),
  }),
  execute: async (params) => {
      const query = params.context.query;
    console.log("\n========================================");
    console.log("✍️ REWRITE-QUERY TOOL CALLED!");
    console.log("========================================");
    console.log("✍️ Original Query:", query);

    const systemPrompt = `You are a query optimization expert. Your job is to rewrite user queries for better vector database search results.

        Guidelines:
        - Expand abbreviations and acronyms
        - Add context keywords
        - Remove stop words and noise
        - Keep queries concise but descriptive
        - Focus on nouns, key concepts, and relationships
        - If the query is vague, make specific assumptions

        Return ONLY the rewritten query, no explanations.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ],
    });

    const rewrittenQueryFinal =
      response.choices[0].message.content?.trim() || query;

    

    console.log("✍️ Rewritten Query:", rewrittenQueryFinal);
    return rewrittenQueryFinal;
  },
});
