import { createClient } from "@supabase/supabase-js";

// Initialize once, outside the tool
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export function storeDocumentChunks(username: string, filename: string, chunks: string[], embeddings: number[][]) {
    
    const rows = chunks.map((chunkText, index) => ({
        username: username,
        filename: filename,
        chunk_index: index,
        content: chunkText,
        embedding: embeddings[index],
    }));
    
    return supabase
    .from('documents')
    .insert(rows)
    .then(({ error }) => {
      if (error) console.error('Error saving document chunks:', error);
    });
}



export function searchDocuments(username: string, queryEmbedding: number[], topK: number) {

    return supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_username : username,
        match_count : topK
    })
}



