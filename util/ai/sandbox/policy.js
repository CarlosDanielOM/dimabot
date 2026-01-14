const { readFileSync } = require('fs');
const { join } = require('path');

/**
 * @typedef {Object} EndpointDefinition
 * @property {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @property {string} url - Full URL of the endpoint
 * @property {Object<string, string>} headers - Required headers
 * @property {string} bodySchema - Body schema as string (for documentation)
 * @property {string} description - Description and additional documentation for the endpoint
 */

/**
 * Parse the doc-llm.txt file and extract allowed endpoints
 * @param {string} [filePath] - Path to the doc-llm.txt file
 * @returns {EndpointDefinition[]}
 */
function parseDocLLM(filePath) {
    const docPath = filePath || join(__dirname, 'doc-llm.txt');
    
    let content;
    try {
        content = readFileSync(docPath, 'utf-8');
    } catch (error) {
        console.error('[Policy] Failed to read doc-llm.txt:', error.message);
        return [];
    }

    const endpoints = [];
    const blocks = content.split('###').map(block => block.trim()).filter(Boolean);

    for (const block of blocks) {
        const lines = block.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed && !trimmed.startsWith('#');
        });

        if (lines.length === 0) continue;

        // First line is METHOD URL
        const firstLine = lines[0].trim();
        const methodMatch = firstLine.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.+)$/i);
        
        if (!methodMatch) continue;

        const method = methodMatch[1].toUpperCase();
        const url = methodMatch[2].trim();

        // Parse headers (lines with ":")
        const headers = {};
        let bodyStartIndex = -1;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Check if this is the start of the body (starts with {)
            if (line.startsWith('{')) {
                bodyStartIndex = i;
                break;
            }

            // Parse header
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const headerName = line.substring(0, colonIndex).trim().toLowerCase();
                const headerValue = line.substring(colonIndex + 1).trim();
                headers[headerName] = headerValue;
            }
        }

        // Extract body schema and description
        let bodySchema = '';
        let description = '';
        
        if (bodyStartIndex !== -1) {
            // Find the closing brace that ends the body schema
            let braceCount = 0;
            let bodyEndIndex = -1;
            
            for (let i = bodyStartIndex; i < lines.length; i++) {
                const line = lines[i];
                for (const char of line) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                }
                
                // When braceCount returns to 0, we've found the end of the body
                if (braceCount === 0) {
                    bodyEndIndex = i;
                    break;
                }
            }
            
            if (bodyEndIndex !== -1) {
                // Extract body schema (from { to })
                bodySchema = lines.slice(bodyStartIndex, bodyEndIndex + 1).join('\n');
                
                // Extract description (everything after the closing brace)
                if (bodyEndIndex + 1 < lines.length) {
                    description = lines.slice(bodyEndIndex + 1).join('\n').trim();
                }
            } else {
                // Fallback: no matching brace found, treat all as body
                bodySchema = lines.slice(bodyStartIndex).join('\n');
            }
        }

        endpoints.push({
            method,
            url,
            headers,
            bodySchema,
            description
        });
    }

    return endpoints;
}

/**
 * Validate if a fetch request is allowed based on the policy
 * @param {string} requestMethod - The HTTP method being used
 * @param {string} requestUrl - The URL being requested
 * @param {EndpointDefinition[]} allowedEndpoints - List of allowed endpoints
 * @returns {{ allowed: boolean, reason?: string, endpoint?: EndpointDefinition }}
 */
function validateRequest(requestMethod, requestUrl, allowedEndpoints) {
    const method = requestMethod.toUpperCase();
    
    // Normalize the URL (remove trailing slashes, handle query params)
    let normalizedUrl;
    try {
        const urlObj = new URL(requestUrl);
        normalizedUrl = urlObj.origin + urlObj.pathname.replace(/\/+$/, '');
    } catch {
        return {
            allowed: false,
            reason: `Invalid URL: ${requestUrl}`
        };
    }

    for (const endpoint of allowedEndpoints) {
        // Check method match
        if (endpoint.method !== method) continue;

        // Normalize endpoint URL for comparison
        let endpointNormalized;
        try {
            const endpointUrlObj = new URL(endpoint.url);
            endpointNormalized = endpointUrlObj.origin + endpointUrlObj.pathname.replace(/\/+$/, '');
        } catch {
            continue;
        }

        // Check URL match (exact or with path parameters)
        if (normalizedUrl === endpointNormalized) {
            return {
                allowed: true,
                endpoint
            };
        }

        // Check for wildcard/pattern matching (e.g., /users/:id)
        const endpointPattern = endpointNormalized.replace(/:[^/]+/g, '[^/]+');
        const regex = new RegExp(`^${endpointPattern}$`);
        if (regex.test(normalizedUrl)) {
            return {
                allowed: true,
                endpoint
            };
        }
    }

    return {
        allowed: false,
        reason: `Request ${method} ${requestUrl} is not in the allowed endpoints list`
    };
}

/**
 * Create a policy validator instance with cached endpoints
 * @param {string} [docPath] - Path to doc-llm.txt
 * @returns {{ validate: (method: string, url: string) => { allowed: boolean, reason?: string, endpoint?: EndpointDefinition }, reload: () => void, getEndpoints: () => EndpointDefinition[] }}
 */
function createPolicyValidator(docPath) {
    let endpoints = parseDocLLM(docPath);

    return {
        /**
         * Validate a request against the policy
         */
        validate(method, url) {
            return validateRequest(method, url, endpoints);
        },

        /**
         * Reload the policy from disk
         */
        reload() {
            endpoints = parseDocLLM(docPath);
        },

        /**
         * Get all allowed endpoints
         */
        getEndpoints() {
            return [...endpoints];
        }
    };
}

module.exports = {
    parseDocLLM,
    validateRequest,
    createPolicyValidator
};
