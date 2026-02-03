/**
 * Shared AI Prompt Construction Utility
 * 
 * This module provides a centralized way to build system messages for AI interactions.
 * It ensures consistency between command-based AI calls and chat-based conversations.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Streamer data structure from cache
 */
interface StreamerData {
    name?: string;
    ai_personality?: {
        personality?: string;
    };
    personality?: string;
    [key: string]: any;
}

/**
 * User context for AI interactions
 */
interface UserContext {
    username: string;
    badges?: string;
}

/**
 * Known user in AI personality configuration
 */
interface KnownUser {
    username: string;
    description: string;
    relationship: string;
    lastInteraction?: Date;
}

/**
 * AI Personality configuration
 */
interface AIPersonality {
    personality?: string;
    rules?: string[];
    knownUsers?: KnownUser[];
    [key: string]: any;
}

/**
 * Chat history message
 */
interface ChatHistoryMessage {
    timestamp: Date | string | number;
    badges?: string;
    username: string;
    message: string;
}

/**
 * Tool context item
 */
interface ToolContext {
    name: string;
    context: any;
}

/**
 * OpenRouter API message format
 */
interface OpenRouterMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Mode for AI interaction
 */
type AIMode = 'command' | 'chat';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_PERSONALITY = "You are a witty, helpful, and slightly sarcastic Twitch bot.";

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Constructs the system and user messages for OpenRouter API calls.
 * 
 * @param streamer - The streamer object from cache (contains name, premium status, ai_personality, etc.)
 * @param userContext - Context about the user making the request
 * @param promptText - The actual prompt/message text from the user
 * @param mode - Either 'command' (for $(ai) one-off calls) or 'chat' (for bot conversations)
 * @param language - The default language for responses (default: 'spanish')
 * @returns Messages array ready for OpenRouter API
 */
export function constructSystemMessages(
    streamer: StreamerData | null | undefined,
    userContext: UserContext | null | undefined,
    promptText: string,
    mode: AIMode = 'command',
    language: string = 'spanish'
): OpenRouterMessage[] {
    // Extract personality from streamer object, fallback to default
    const personality = streamer?.ai_personality?.personality || 
                        streamer?.personality || 
                        DEFAULT_PERSONALITY;
    
    const streamerName = streamer?.name || 'Unknown Streamer';
    
    // Build character limits based on mode
    const characterLimit = mode === 'command' 
        ? "Keep responses under 400 characters."
        : "Keep responses under 1000 characters if possible unless the topic requires more detail.";
    
    // Build mode-specific instructions
    const modeInstruction = mode === 'command'
        ? "Strictly follow the prompt instruction provided by the user."
        : "Engage in natural conversation with the user.";
    
    // Construct the system message
    const systemContent = `<identity>
You are DomDimaBot, the AI assistant for streamer '${streamerName}'. You are supposed to be helpful but also engaging and fun, you should speak in ${language} by default but can adapt to other languages.
</identity>

<personality>
${personality}
</personality>

<constraints>
- ${characterLimit}
- No hashtags.
- Do not offer assistance or ask how you can help; just react naturally to the context.
- ${modeInstruction}
- Respond in the same language the user is speaking, unless they explicitly request otherwise.
- Be concise and engaging, matching the energy of Twitch chat.
</constraints>`;

    // Construct the user message
    const username = userContext?.username || 'Anonymous';
    const badgePrefix = userContext?.badges ? `${userContext.badges} ` : '';
    
    const userContent = `${badgePrefix} User ${username} says: ${promptText}`;
    
    // Return the messages array
    return [
        {
            role: 'system',
            content: systemContent
        },
        {
            role: 'user',
            content: userContent
        }
    ];
}

/**
 * Constructs enhanced system messages for chat mode with additional context.
 * This version includes chat history, known users, and channel rules.
 * 
 * @param streamer - The streamer object from cache
 * @param personality - The full AIPersonality document from DB/cache
 * @param userContext - Context about the user making the request
 * @param promptText - The actual prompt/message text from the user
 * @param chatHistory - Array of recent chat messages for context
 * @param toolContext - Optional tool context (e.g., search results)
 * @returns Messages array ready for OpenRouter API
 */
export function constructChatSystemMessages(
    streamer: StreamerData | null | undefined,
    personality: AIPersonality | null | undefined,
    userContext: UserContext | null | undefined,
    promptText: string,
    chatHistory: ChatHistoryMessage[] = [],
    toolContext: ToolContext[] = []
): OpenRouterMessage[] {
    const streamerName = streamer?.name || 'Unknown Streamer';
    
    // Extract personality text, fallback to default
    const personalityText = personality?.personality || DEFAULT_PERSONALITY;
    
    // Build known users context
    let knownUsersContext = "No known users configured.";
    if (personality?.knownUsers && personality.knownUsers.length > 0) {
        knownUsersContext = personality.knownUsers
            .map(user => `${user.username} is ${user.description} and has a ${user.relationship} relationship with the channel`)
            .join('\n');
    }
    
    // Build channel rules context
    let rulesContext = "No specific rules configured.";
    if (personality?.rules && personality.rules.length > 0) {
        rulesContext = personality.rules.join('\n');
    }
    
    // Build chat history context
    let chatHistoryContext = "No previous chat history.";
    if (chatHistory.length > 0) {
        chatHistoryContext = chatHistory.map(msg => {
            const msgTimestamp = new Date(msg.timestamp);
            const timeInHours = `${msgTimestamp.getHours().toString().padStart(2, '0')}:${msgTimestamp.getMinutes().toString().padStart(2, '0')}`;
            return `[${timeInHours}] ${msg.badges || ''} ${msg.username}: ${msg.message}`;
        }).join('\n');
    }
    
    // Build tool context section
    let toolContextSection = "No tool context provided.";
    if (toolContext.length > 0) {
        toolContextSection = toolContext.map(tool => `[${tool.name}] ${JSON.stringify(tool.context)}`).join('\n');
    }
    
    // Construct the enhanced system message
    const systemContent = `<system-instructions>
    <system-rules>
        You are a livestream chatbot where multiple people hang in. You will receive a personality, some users with history with the streamer, channel rules and chat history for context. Only use the chat history to formulate a correct answer to the user that actually spoke to you and not to all the chat history. Personality was given to you by the streamer of the channel you are in which is ${streamerName}.
    </system-rules>
    
    <identity>
        You are DomDimaBot, the AI assistant for streamer '${streamerName}'.
    </identity>
    
    <persona>
        ${personalityText}
    </persona>

    <channel-rules>
        ${rulesContext}
    </channel-rules>

    <known-users>
        ${knownUsersContext}
    </known-users>

    <chat-history>
        This is the chat history of the channel, only use it to formulate a correct answer to the user that actually spoke to you. You can use it to understand the context, how users interact with each other and the streamer, and their jokes.
        ${chatHistoryContext}
    </chat-history>

    <critical-rules>
        1. Only reply to the user with the [CURRENT] timestamp and not to all the chat history unless the user asks you to do so.
        2. Chat history and current message is formatted as [TIME] [BADGES] [USERNAME]: [MESSAGE]
        3. Notice the user badges and adjust your response to the user's level and status based on your personality and the channel rules.
        4. Keep your responses short and concise, avoid long paragraphs and keep it simple and easy to understand unless you feel like you need to elaborate more or is a complex topic. Aim for under 1000 characters.
        5. Do not respond with any [TIME] [BADGES] [USERNAME]: [MESSAGE] format, only respond with the message.
        6. If you are speaking directly to the user, do not forget to tag them with @username.
        7. No hashtags.
        8. Do not offer assistance; just react naturally to the context.
    </critical-rules>
    
    <tool-context>
        This is the tool context provided to you if any, treat this as information that you already know and use it to formulate a correct answer. If for example the tool name is [SEARCH] do not say you used the search tool or that you found it on the internet, make it seem like you already knew the information. Always respond with the personality you were created with.
        ${toolContextSection}
    </tool-context>
    
</system-instructions>`;

    // Construct the user message with badges
    const username = userContext?.username || 'Anonymous';
    const badgePrefix = userContext?.badges ? `${userContext.badges}` : '';
    
    const userContent = `[CURRENT] ${badgePrefix} ${username}: ${promptText}`;
    
    return [
        {
            role: 'system',
            content: systemContent
        },
        {
            role: 'user',
            content: userContent
        }
    ];
}
