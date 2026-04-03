import { error, debug } from '../../logger.js';
import { EMBEDDING_DIMENSIONS } from '../constants.js';
import { createFetchWithRetry } from '../fetch.utils.js';

const EMBEDDING_API_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBEDDING_TIMEOUT = 20000;

const fetchWithRetry = createFetchWithRetry({ timeout: EMBEDDING_TIMEOUT, retries: 3 });

export interface IOpenRouterEmbeddingRequest {
    model: string;
    input: string | string[];
    dimensions?: number;
}

export interface IOpenRouterEmbeddingResponse {
    data: Array<{
        embedding: number[];
        index: number;
        object: string;
    }>;
    model: string;
    usage?: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

export interface IOpenRouterEmbeddingError {
    error: {
        message: string;
        type: string;
        code: number;
    };
}

export interface IEmbeddingResult {
    error: boolean;
    message?: string;
    embedding?: number[];
    model?: string;
    tokens?: number;
}

export interface IBatchEmbeddingResult extends IEmbeddingResult {
    embeddings?: number[][];
}

const LANGUAGE_PATTERNS: Record<string, RegExp> = {
    english: /\b(the|be|to|of|and|a|in|that|have|i|it|for|not|on|with|he|as|you|do|at|this|but|his|by|from|they|we|say|her|she|or|an|will|my|one|all|would|there|their|what|so|up|out|if|about|who|get|which|go|me|when|make|can|like|time|no|just|him|know|take|people|into|year|your|good|some|could|them|see|other|than|then|now|look|only|come|its|over|think|also|back|after|use|two|how|our|work|first|well|way|even|new|want|because|any|these|give|day|most|us)\b/gi,
    spanish: /\b(el|la|de|que|y|a|en|un|ser|se|no|haber|por|con|su|para|como|estar|tener|le|lo|todo|pero|más|hacer|o|poder|decir|este|ir|otro|ese|sí|si|ya|ver|porque|saber|dar|cuando|muy|hasta|donde|quien|desde|todo|sin|sobre|ser|entre|así|nos|también|me|hay|aunque|tal|vez|bien|tanto|ahora|siempre|entonces|aqui|nada|alguien|alguno|algo|aquel|esa|ese|esta|estos|estoy|está|están|fuera|mi|mí|mía|mío|mucho|muchos|muy|nada|ni|no|nos|nosotros|nuestra|nuestras|nuestro|nuestros|o|os|otra|otras|otro|otros|para|pero|poco|por|porque|primera|primero|puede|pueden|pues|que|qué|quien|quién|quiénes|sé|saber|se|sea|seas|sean|seáis|segun|según|ser|si|sí|sido|siempre|siendo|sin|sino|so|sobre|sois|somos|son|soy|su|sus|suya|suyas|suyo|suyos|tal|también|tan|tanta|tantas|tanto|tantos|te|tendrá|tendrán|tengo|ti|tiene|tienen|toda|todas|todavía|todo|todos|tu|tú|tus|tuya|tuyas|tuyo|tuyos|última|último|un|una|unas|uno|unos|usted|ustedes|va|van|veces|ver|vez|y|ya|yo|él)\b/gi,
    portuguese: /\b(o|a|os|as|de|do|da|dos|das|em|para|por|com|sem|um|uma|uns|umas|ser|estar|ter|haver|fazer|ir|poder|dever|querer|saber|ou|e|mas|também|já|ainda|se|não|sim|então|assim|porque|pois|que|quem|onde|quando|como|quanto|qual|quais|qualquer|algum|alguma|alguns|algumas|nenhum|nenhuma|todo|toda|todos|todas|muito|muita|muitos|muitas|pouco|pouca|poucos|poucas|esse|essa|esses|essas|isto|isso|aquilo|meu|minha|meus|minhas|teu|tua|teus|tuas|seu|sua|seus|suas|nosso|nossa|nossos|nossas|esse|esta|isto|isso|aquilo|isto|me|te|se|nos|lhe|lhes|mim|ti|ele|ela|nós|vós|eles|elas|outro|outra|outros|outras|mesmo|mesma|mesmos|mesmas|tanto|tanta|tantos|tantas|todo|toda|todos|todas|cada|algum|alguma|alguns|algumas|certo|certa|certos|certas|diversos|diversas|vários|várias|bom|boa|bons|boas|grande|grandes|pequeno|pequena|pequenos|pequenas|novo|nova|novos|novas|velho|velha|velhos|velhas|poder|dever|querer|saber|fazer|ir|vir|ter|haver|dar|dizer|ver|pôr|ficar|sair|entrar|chegar|partir|passar|deixar|levar|trazer|tomar|pegar|arrancar|tirar|colocar|pôr|meter|introduzir|inserir|juntar|adicionar|acrescentar|somar|unir|ligar|conectar|desconectar|ligar|desligar|abrir|fechar)\b/gi,
    french: /\b(le|la|les|de|du|des|un|une|des|et|ou|où|que|qui|quoi|dont|lequel|laquelle|lesquels|lesquelles|ce|cet|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|tout|toute|tous|toutes|même|autres|autre|certains|certaine|certaines|certains|plusieurs|chaque|aucun|aucune|aucuns|aucunes|nul|nulle|nuls|nulles|plusieurs|quelques|peu|beaucoup|trop|pas|non|ne|ni|car|mais|donc|or|ni|car|en|vers|chez|avec|sans|sur|sous|dans|par|pour|contre|entre|pendant|depuis|jusqu|avant|après|au|aux|à|en|y|dedans|dehors|haut|bas|ici|là|loin|près|bientôt|maintenant|alors|ensuite|puis|finalement|souvent|toujours|jamais|parfois|rarement|ainsi|comment|combien|pourquoi|quand|où|je|tu|il|elle|nous|vous|ils|elles|on|ceci|cela|ce|ça|tout|rien|quelque|chose|personne|chacun|aucun|nul|plus|moins|autant|mieux|pire|bien|mal|bon|mauvais|vrai|faux|grand|petit|beau|laid|nouveau|vieux|jeune|long|court|haut|bas|gros|mince|fort|faible|riche|pauvre|heureux|malheureux|facile|difficile|possible|impossible|certain|probable|vrai|être|avoir|faire|aller|dire|voir|pouvoir|vouloir|savoir|devoir|venir|mettre|prendre|donner|parler|trouver|penser|croire|passer|aimer|regarder|voir|entendre|écouter|comprendre|savoir|connaître|sembler|devenir|rester|sortir|entrer|arriver|partir|venir|retourner|rentrer|revenir|sortir|monter|descendre|tomber|aller|venir|partir|arriver)\b/gi
};

export function detectLanguage(text: string, threshold: number = 0.1): string {
    const words = text.toLowerCase().match(/\b[a-zA-Z]+\b/g);
    if (!words || words.length === 0) return 'unknown';

    let bestLanguage = 'unknown';
    let bestScore = 0;

    for (const [language, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
        let matches = 0;
        for (const word of words) {
            if (pattern.test(word)) {
                matches++;
            }
        }
        const percentage = matches / words.length;
        if (percentage > bestScore && percentage >= threshold) {
            bestScore = percentage;
            bestLanguage = language;
        }
    }

    return bestLanguage;
}

export async function generateEmbedding(text: string, model: string = 'qwen/qwen3-embedding-8b'): Promise<IEmbeddingResult> {
    try {
        const startTime = Date.now();

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://domdimabot.com',
            'X-Title': 'DomDimaBot'
        };

        const dimensions = EMBEDDING_DIMENSIONS[model];

        const requestBody: IOpenRouterEmbeddingRequest = {
            model,
            input: text,
            ...(dimensions && { dimensions })
        };

        const response = await fetchWithRetry(EMBEDDING_API_URL, {
            method: 'POST',
            headers: headers as Record<string, string>,
            body: JSON.stringify(requestBody)
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        if (!response.ok) {
            const errorText = await response.text();
            error({
                message: 'OpenRouter embedding API error',
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                model,
                duration
            });
            return {
                error: true,
                message: `OpenRouter API error: ${response.status} ${response.statusText}`
            };
        }

        const responseData: IOpenRouterEmbeddingResponse | IOpenRouterEmbeddingError = await response.json();

        if ('error' in responseData) {
            error({
                message: 'OpenRouter embedding returned error',
                error: responseData.error,
                model,
                duration
            });
            return {
                error: true,
                message: responseData.error.message
            };
        }

        const embedding = responseData.data[0].embedding;

        debug({
            message: 'Embedding generated successfully',
            dimensions: embedding.length,
            model,
            tokens: responseData.usage?.total_tokens,
            duration
        }, { destination: 'cache' });

        return {
            error: false,
            embedding,
            model,
            tokens: responseData.usage?.total_tokens
        };
    } catch (err) {
        error({
            message: 'Error generating embedding',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            model
        });
        return {
            error: true,
            message: 'Failed to generate embedding'
        };
    }
}

export async function generateEmbeddings(texts: string[], model: string = 'qwen/qwen3-embedding-8b'): Promise<IBatchEmbeddingResult> {
    try {
        if (texts.length === 0) {
            return {
                error: true,
                message: 'No texts provided'
            };
        }

        if (texts.length === 1) {
            const result = await generateEmbedding(texts[0], model);
            if (!result.error && result.embedding) {
                return {
                    error: false,
                    embeddings: [result.embedding],
                    model: result.model,
                    tokens: result.tokens
                };
            }
            return result;
        }

        const startTime = Date.now();

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://domdimabot.com',
            'X-Title': 'DomDimaBot'
        };

        const dimensions = EMBEDDING_DIMENSIONS[model];

        const requestBody: IOpenRouterEmbeddingRequest = {
            model,
            input: texts,
            ...(dimensions && { dimensions })
        };

        const response = await fetchWithRetry(EMBEDDING_API_URL, {
            method: 'POST',
            headers: headers as Record<string, string>,
            body: JSON.stringify(requestBody)
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        if (!response.ok) {
            const errorText = await response.text();
            error({
                message: 'OpenRouter batch embedding API error',
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                model,
                batchSize: texts.length,
                duration
            });
            return {
                error: true,
                message: `OpenRouter API error: ${response.status} ${response.statusText}`
            };
        }

        const responseData: IOpenRouterEmbeddingResponse | IOpenRouterEmbeddingError = await response.json();

        if ('error' in responseData) {
            error({
                message: 'OpenRouter batch embedding returned error',
                error: responseData.error,
                model,
                batchSize: texts.length,
                duration
            });
            return {
                error: true,
                message: responseData.error.message
            };
        }

        const embeddings = responseData.data.map(item => item.embedding);

        debug({
            message: 'Batch embeddings generated successfully',
            count: embeddings.length,
            dimensions: embeddings[0]?.length,
            model,
            tokens: responseData.usage?.total_tokens,
            duration
        }, { destination: 'cache' });

        return {
            error: false,
            embeddings,
            model,
            tokens: responseData.usage?.total_tokens
        };
    } catch (err) {
        error({
            message: 'Error generating batch embeddings',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            batchSize: texts.length,
            model
        });
        return {
            error: true,
            message: 'Failed to generate batch embeddings'
        };
    }
}
