import {Elysia, t} from 'elysia';
import {swagger} from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors' 
import { mastra } from './mastra/index.js';
import { chatAgent } from './mastra/agents/chatAgent';
import { createClient } from '@supabase/supabase-js'
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
            const {message} = body as {message: string};

            const agent = mastra.getAgent("chatAgent");
            const supabase = createClient(
                process.env.SUPABASE_URL!,
                process.env.SUPABASE_ANON_KEY!
            );

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

            // Call mastra agent (this is the main blocking operation)
            const response = await agent.generate(message,
                {
                    memory: {
                    thread: sessionId,
                    resource: body.userId.toString(),
                },
            })

            // Fire-and-forget: save assistant response to supabase (non-blocking)
            const saveAssistantMessage = supabase
                .from('conversations')
                .insert([
                    {
                        session_id: sessionId,
                        username: body.userId,
                        role: 'assistant',
                        content: response.text,
                    }
                ])
                .then(({ error }) => {
                    if (error) console.error('Error saving assistant message:', error);
                });

            // Optionally wait for both saves to complete before returning
            // Remove this line if you want true fire-and-forget
            // await Promise.all([saveUserMessage, saveAssistantMessage])
            
            return {
                sessionId,
                userName: body.userId.toString(), // placeholder, replace with actual user name from supabase
                userMessage: message,
                assistantMessage: response.text,
            };
        },
        {
            // request validation schema
            headers: t.Object({
                'x-session-id': t.String({ description: 'Session ID for the chat', example: 'session_1' })
            }),
            body: t.Object({
                message: t.String({ description: 'User message to the chatbot', example: 'Hello, how are you?' }),
                userId: t.String({ description: 'ID of the user sending the message', example: 'rushbh' }),
            }),


            response: t.Object({
                sessionId: t.String(),
                userName: t.String(),
                userMessage: t.String(),
                assistantMessage: t.String(),
            })
        }
    )

    .listen(process.env.PORT || 3000);

console.log(`Server running at http://localhost:${app.server?.port}`);
console.log(`Swagger docs available at http://localhost:${app.server?.port}/swagger`);