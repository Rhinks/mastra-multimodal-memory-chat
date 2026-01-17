import {Elysia, t} from 'elysia';
import {swagger} from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors' 
import { mastra } from './mastra/index.js';
import { chatAgent } from './mastra/agents/chatAgent.js';
import { createClient } from '@supabase/supabase-js'
import { RuntimeContext } from '@mastra/core/runtime-context';
import { chunkText, extractTextFromDocument } from './services/extractor.js';
import { generateEmbeddingsBatch } from './services/embeddings.js';
import { storeDocumentChunks } from './services/vectorStore.js';


const app = new Elysia()
    .use(cors())
    .use(swagger({
        documentation:{
            info:{
                title: 'RAG Hybrid Memory API',
                description: 'A chatbot API mastra agents and supabase storage',
                version:'1.0.0',
            }
        }
    }))

    .get('/', () => 'RAG Hybrid Memory API is running!')

    //chat endpoint

    .post('/chat', 
        async ({body, headers}) => {
            const sessionId = headers['x-session-id'] as string;
            const {message, documents} = body;
            
            console.log(` Documents uploaded: ${documents ? documents.length : 0}`);

            // Create supabase client for document checking
            const supabase = createClient(
                process.env.SUPABASE_URL!,
                process.env.SUPABASE_ANON_KEY!
            );

            //check if documents were uploaded
            if (documents && documents.length > 0) {
                console.log(`📄 ${documents.length} document(s) uploaded for processing`);
                
                //process each document
                for (const doc of documents) {
                    try {
                        // Check if document already exists for this user
                        const { data: existingDoc } = await supabase
                            .from('documents')
                            .select('id')
                            .eq('username', body.userId)
                            .eq('filename', doc.name)
                            .limit(1);

                        if (existingDoc && existingDoc.length > 0) {
                            console.log(`📄 Document ${doc.name} already exists for user ${body.userId}, skipping...`);
                            continue;
                        }

                        console.log(` Processing uploaded document: ${doc.name} (${doc.size} bytes)`);

                    const buffer = Buffer.from(await doc.arrayBuffer());

                    const text = await extractTextFromDocument(buffer);
                    console.log(` Extracted text length: ${text.length} characters`);

                    const chunks = chunkText(text);
                    console.log(` Created ${chunks.length} text chunks from document`);

                    const embeddings = await generateEmbeddingsBatch(chunks);
                    console.log(` Generated embeddings for ${embeddings.length} chunks`);

                    await storeDocumentChunks(
                        body.userId.toString(),
                        doc.name,
                        chunks,
                        embeddings
                    );

                    console.log(` Stored document chunks and embeddings in vector store`);}
                    catch (err) {
                        console.error(` Error processing document ${doc.name}:`, err);
                    }
                }
            }
            
            //get mastra chat agent
            const agent = mastra.getAgent("chatAgent");

            console.log(' Chat request - User:', body.userId, 'Session:', sessionId);
            console.log(' Message:', message);

            // Create RuntimeContext for toolsi
            const runtimeContext = new RuntimeContext();
            runtimeContext.set('username', body.userId.toString());
            runtimeContext.set('excludeSessionId', sessionId);
            runtimeContext.set('query', message);

            // Fire-and-forget: save user message to supabase (non-blocking)
            const saveUserMessage = supabase
                .from('conversations')
                .insert([
                    {
                        session_id: sessionId,
                        username: body.userId,
                        role: 'user',
                        content: message,
                    }
                ])
                .then(({ error }) => {
                    if (error) console.error('Error saving user message:', error);
                });
``
            // Call mastra agent with streaming
            const stream = await agent.stream(message, {
                memory: {
                    thread: sessionId,
                    resource: body.userId.toString(),
                },
                runtimeContext: runtimeContext,
            });

            // Collect full response while streaming to client
            let fullText = '';
            
            // Return SSE stream
            return new Response(
                new ReadableStream({
                    async start(controller) {
                        try {
                            for await (const chunk of stream.textStream) {
                                fullText += chunk;
                                // Send chunk as SSE
                                controller.enqueue(
                                    new TextEncoder().encode(`data: ${JSON.stringify({ chunk })}\n\n`)
                                );
                            }
                            
                            // Save full response after streaming completes
                            supabase
                                .from('conversations')
                                .insert([
                                    {
                                        session_id: sessionId,
                                        username: body.userId,
                                        role: 'assistant',
                                        content: fullText,
                                    }
                                ])
                                .then(({ error }) => {
                                    if (error) console.error('Error saving assistant message:', error);
                                });
                            
                            // Send completion marker
                            controller.enqueue(
                                new TextEncoder().encode(`data: ${JSON.stringify({ done: true, fullText })}\n\n`)
                            );
                            controller.close();
                        } catch (error) {
                            controller.error(error);
                        }
                    }
                }),
                {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    },
                }
            ); 
        },
        {
            type: 'multipart/form-data',
            // request validation schema
            headers: t.Object({
                'x-session-id': t.String({ description: 'Session ID for the chat', example: 'session_1' })
            }),
            body: t.Object({
                message: t.String({ description: 'User message to the chatbot', example: 'Hello, how are you?' }),
                userId: t.String({ description: 'ID of the user sending the message', example: 'rushbh' }),
                documents: t.Optional(t.Files( { description: 'Optional documents to assist the agent' }))
            }),
        }
    )

    .listen(process.env.PORT || 3000);

console.log(`Server running at http://localhost:${app.server?.port}`);
console.log(`Swagger docs available at http://localhost:${app.server?.port}/swagger`);


