import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Initialize once, outside the tool
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export const retrieveRecentConversation = createTool({
  id: "retrieve-recent-conversation",
  description: "REQUIRED when user asks about previous conversations or past sessions. Retrieves conversation history for the current user from their past sessions (excluding the current session). Use this when user asks 'what did we talk about', 'last time', 'before', 'yesterday', or references past interactions. Returns formatted chat history grouped by session.",
  inputSchema: z.object({
    limit: z.number().default(20).describe("Maximum number of messages to retrieve. Use 10-20 for quick context, 30-50 for detailed history."),
  }),
  execute: async (params: any) => {
    console.log('\n========================================');
    console.log('🔍 RETRIEVE-RECENT-CONVERSATION TOOL CALLED!');
    console.log('========================================');
    
    // runtimeContext is passed separately, not inside context
    const runtimeContext = params.runtimeContext;
    const username = runtimeContext?.get?.('username');
    const excludeSessionId = runtimeContext?.get?.('excludeSessionId');
    const limit = params.context?.limit || 20;
    
    
    try {
      if (!username) {
        console.error('🔍 ERROR: No username found in runtimeContext!');
        return 'Error: Unable to identify user for conversation history lookup.';
      }
      
      const { data, error } = await supabase
        .from('conversations')
        .select('session_id, role, content, created_at')
        .eq('username', username)
        .neq('session_id', excludeSessionId)
        .order('created_at', { ascending: false })
        .limit(limit);

      console.log('🔍 Query result - rows found:', data?.length || 0);
      if (error) console.error('🔍 Query error:', error);

      if (error) throw error;

      if (!data || data.length === 0) {
        return 'No previous conversation history found for this user.';
      }

      // Format for LLM
      let formatted = `Previous conversations for ${username} (${data.length} messages):\n\n`;
      let currentSession = '';
      
      data.reverse().forEach(msg => {
        if (msg.session_id !== currentSession) {
          currentSession = msg.session_id;
          formatted += `\n[Session: ${msg.session_id.slice(0, 8)}...]\n`;
        }
        formatted += `${msg.role}: ${msg.content}\n`;
      });

      return formatted;
      
    } catch (error) {
      console.error('Error retrieving conversations:', error);
      return `Unable to retrieve conversation history: ${error}`;
    }
  }
});