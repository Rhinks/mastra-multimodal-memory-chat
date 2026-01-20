import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors'
import { mastra } from './mastra/index.js';
import { chatAgent } from './mastra/agents/chatAgent.js';
import { createClient } from '@supabase/supabase-js'
import { RuntimeContext } from '@mastra/core/runtime-context';
import { chunkText, extractTextFromDocument } from './services/extractor.js';
import { generateEmbeddingsBatch } from './services/embeddings.js';
import { storeDocumentChunks } from './services/vectorStore.js';
import stream from 'stream';

const convertToBase64 = async (audioStream: NodeJS.ReadableStream): Promise<string> => {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        audioStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        audioStream.on('error', (err) => reject(err));
        audioStream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve(buffer.toString('base64'));
        });
    });
};

const app = new Elysia()
    .use(cors({
        origin: true,
        credentials: true,
    }))
    .use(swagger({
        documentation: {
            info: {
                title: 'RAG Hybrid Memory API',
                description: 'A chatbot API mastra agents and supabase storage',
                version: '1.0.0',
            }
        }
    }))

    .get('/', () => 'RAG Hybrid Memory API is running!')

    // 🔹 Realtime Voice Endpoint - Create ephemeral client secret
    .get('/realtime', async ({ query }) => {
        const conversationId = query.conversationId ?? 'default';

        try {
            // Validate environment variables
            if (!process.env.OPENAI_API_KEY) {
                throw new Error('OPENAI_API_KEY environment variable not set');
            }

            console.log('🎤 Creating realtime client secret for:', conversationId);

            // ✅ Use OpenAI's official endpoint to get ephemeral token
            // This endpoint returns a temporary token that can be safely used in the frontend
            const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini-realtime-preview-2024-12-17',
                    voice: 'alloy',
                    instructions: 'You are a warm, friendly, and inviting voice assistant. You MUST speak ONLY English. If spoken to in another language, politely explain in English that you can only communicate in English. Start every new conversation with a very warm and welcoming tone.',
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ OpenAI session error:', errorData);
                throw new Error(`OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
            }

            const sessionData = await response.json();
            console.log('✅ Session created, full response:', JSON.stringify(sessionData, null, 2));
            console.log('✅ client_secret structure:', sessionData.client_secret);
            console.log('✅ client_secret.value:', sessionData.client_secret.value);

            // Return the full token structure
            return {
                client_secret: sessionData.client_secret,
                session_id: conversationId,
            };
        } catch (error) {
            console.error('❌ Realtime session error:', error);
            throw error;
        }
    }, {
        query: t.Object({
            conversationId: t.Optional(t.String({
                description: 'Conversation ID for the realtime session',
                example: 'default'
            }))
        })
    })


    // 🔹 Chat endpoint
    .post('/chat',
        async ({ body, headers }) => {
            const sessionId = headers['x-session-id'] as string;
            const { message, documents } = body;

            console.log(`📄 Documents uploaded: ${documents ? documents.length : 0}`);

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

                        console.log(`📄 Processing uploaded document: ${doc.name} (${doc.size} bytes)`);

                        const buffer = Buffer.from(await doc.arrayBuffer());

                        const text = await extractTextFromDocument(buffer);
                        console.log(`📄 Extracted text length: ${text.length} characters`);

                        const chunks = chunkText(text);
                        console.log(`📄 Created ${chunks.length} text chunks from document`);

                        const embeddings = await generateEmbeddingsBatch(chunks);
                        console.log(`📄 Generated embeddings for ${embeddings.length} chunks`);

                        await storeDocumentChunks(
                            body.userId.toString(),
                            doc.name,
                            chunks,
                            embeddings
                        );

                        console.log(`✅ Stored document chunks and embeddings in vector store`);
                    }
                    catch (err) {
                        console.error(`❌ Error processing document ${doc.name}:`, err);
                    }
                }
            }

            //get mastra chat agent
            const agent = mastra.getAgent("chatAgent");

            console.log('💬 Chat request - User:', body.userId, 'Session:', sessionId);
            console.log('💬 Message:', message);

            // Create RuntimeContext for tools
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
                            let audioBase64 = '';
                            if (body.voice === 'true' && fullText) {
                                try {
                                    console.log('🎙️ Generating TTS for response...');
                                    const audioStream = await agent.voice.speak(fullText);
                                    if (audioStream) {
                                        audioBase64 = await convertToBase64(audioStream as any);
                                    }
                                    console.log('✅ TTS generated successfully');
                                } catch (err) {
                                    console.error('❌ TTS generation error:', err);
                                }
                            }

                            controller.enqueue(
                                new TextEncoder().encode(`data: ${JSON.stringify({ done: true, fullText, audio: audioBase64 })}\n\n`)
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
                voice: t.Optional(t.String({ description: 'Whether to return TTS audio in the response ("true" or "false")' })),
                documents: t.Optional(t.Files({ description: 'Optional documents to assist the agent' }))
            }),
        }
    )

    // 🔹 SDP Exchange for WebRTC Realtime (Unified Interface)
    .post('/realtime-sdp', async ({ request, body }) => {
        try {
            console.log('📝 SDP exchange request received');
            console.log('📋 Request headers:', Object.fromEntries(request.headers));

            const sdp = await request.text();
            console.log('📋 SDP received:', sdp ? `${sdp.length} chars` : 'empty/null');
            console.log('📋 First 200 chars of SDP:', sdp?.substring(0, 200));

            if (!sdp) {
                throw new Error('Missing SDP');
            }

            console.log('📋 SDP length:', sdp.length);

            // OpenAI expects application/sdp directly, NOT multipart/form-data!
            // Session config (model, voice) should be set in query params or initial session
            console.log('📤 Sending SDP to OpenAI with application/sdp...');

            const response = await fetch(
                'https://api.openai.com/v1/realtime/calls?model=gpt-4o-mini-realtime-preview-2024-12-17',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/sdp',
                    },
                    body: sdp,
                }
            );

            const responseText = await response.text();
            console.log('📥 OpenAI response status:', response.status);

            if (!response.ok) {
                console.error('❌ OpenAI error:', responseText.substring(0, 500));
                throw new Error(`OpenAI error (${response.status}): ${responseText.substring(0, 200)}`);
            }

            console.log('✅ SDP answer received');
            console.log('📋 Answer preview:', responseText.substring(0, 200));

            // OpenAI returns the SDP answer as plain text
            return new Response(responseText, {
                headers: { 'Content-Type': 'application/sdp' }
            });
        } catch (error) {
            console.error('❌ SDP exchange error:', error);
            return new Response(
                JSON.stringify({ error: (error as Error).message }),
                {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
    })

    // 🔹 WebSocket Proxy for Realtime Audio
    .ws('/realtime-ws', async (ws) => {
        let openaiWs: WebSocket | null = null;
        let token: string | null = null;
        let isOpenaiConnected = false;

        console.log('🔌 Browser WebSocket connected');

        const forwardToOpenAI = (message: any) => {
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.send(JSON.stringify(message));
            }
        };

        ws.addEventListener('message', async (event) => {
            try {
                const data = JSON.parse(event.data.toString());

                // First message should contain the auth token
                if (data.type === 'auth' && data.token) {
                    token = data.token;
                    console.log('🔐 Auth token received, connecting to OpenAI...');

                    // Create OpenAI WebSocket connection with proper headers
                    openaiWs = new WebSocket(
                        'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17',
                        {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                            },
                        } as any
                    );

                    openaiWs.addEventListener('open', () => {
                        console.log('✅ OpenAI WebSocket opened, authenticating...');

                        // Send auth in first message with bearer token
                        openaiWs!.send(JSON.stringify({
                            type: 'session.update',
                            session: {
                                type: 'realtime',
                                modalities: ['text', 'audio'],
                            },
                        }));

                        // Wait a moment then send connected message to browser
                        setTimeout(() => {
                            isOpenaiConnected = true;
                            console.log('✅ OpenAI authenticated');
                            ws.send(JSON.stringify({ type: 'connected' }));
                        }, 100);
                    });

                    openaiWs.addEventListener('message', (msg: any) => {
                        try {
                            ws.send(msg.data);
                        } catch (e) {
                            console.error('Error forwarding message:', e);
                        }
                    });

                    openaiWs.addEventListener('error', (error: any) => {
                        console.error('❌ OpenAI WebSocket error:', error);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'OpenAI connection error: ' + error.message
                        }));
                    });

                    openaiWs.addEventListener('close', () => {
                        console.log('❌ OpenAI WebSocket closed');
                        isOpenaiConnected = false;
                    });
                } else if (isOpenaiConnected && openaiWs) {
                    // Forward all other messages to OpenAI
                    console.log('📤 Forwarding message to OpenAI:', data.type);
                    forwardToOpenAI(data);
                } else {
                    console.log('⚠️ Not ready to forward:', data.type);
                }
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        });

        ws.addEventListener('close', () => {
            console.log('❌ Browser WebSocket closed');
            if (openaiWs) {
                openaiWs.close();
            }
        });

        ws.addEventListener('error', (error: any) => {
            console.error('Browser WebSocket error:', error);
        });
    })

    .listen(process.env.PORT || 8080);

console.log(`🚀 Server running at http://localhost:${app.server?.port}`);
console.log(`📚 Swagger docs available at http://localhost:${app.server?.port}/swagger`);
