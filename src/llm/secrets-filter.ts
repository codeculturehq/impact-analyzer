/**
 * Secrets filter for LLM enhancement
 * Detects and redacts potential secrets before sending to LLM
 */

// Common secret patterns
const SECRET_PATTERNS = [
  // API Keys
  { name: 'API Key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi },
  { name: 'Bearer Token', pattern: /bearer\s+([a-zA-Z0-9_-]{20,})/gi },
  { name: 'Authorization Header', pattern: /authorization\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi },

  // AWS
  { name: 'AWS Access Key', pattern: /(?:aws[_-]?)?access[_-]?key[_-]?id\s*[:=]\s*['"]?([A-Z0-9]{20})['"]?/gi },
  { name: 'AWS Secret Key', pattern: /(?:aws[_-]?)?secret[_-]?(?:access[_-]?)?key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi },

  // Database
  { name: 'Database URL', pattern: /(?:database[_-]?url|db[_-]?url|connection[_-]?string)\s*[:=]\s*['"]?([^'"\s]+)['"]?/gi },
  { name: 'Password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]?([^'"\s]{8,})['"]?/gi },

  // OAuth/JWT
  { name: 'Client Secret', pattern: /client[_-]?secret\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi },
  { name: 'JWT', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g },

  // Private Keys
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },

  // Generic Secrets
  { name: 'Secret', pattern: /(?:secret|token|credential)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{16,})['"]?/gi },

  // GitHub
  { name: 'GitHub Token', pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g },

  // Stripe
  { name: 'Stripe Key', pattern: /sk_(?:test|live)_[a-zA-Z0-9]{24,}/g },
  { name: 'Stripe Publishable', pattern: /pk_(?:test|live)_[a-zA-Z0-9]{24,}/g },

  // Slack
  { name: 'Slack Token', pattern: /xox[baprs]-[a-zA-Z0-9-]+/g },
  { name: 'Slack Webhook', pattern: /hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/g },

  // IP Addresses (optional - may want to redact in some contexts)
  // { name: 'IP Address', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
];

export interface FilterResult {
  filtered: string;
  secretsFound: string[];
}

/**
 * Filter secrets from text content
 */
export function filterSecrets(content: string): FilterResult {
  let filtered = content;
  const secretsFound: string[] = [];

  for (const { name, pattern } of SECRET_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      for (const match of matches) {
        secretsFound.push(name);
        filtered = filtered.replace(match, `[REDACTED ${name}]`);
      }
    }
  }

  return {
    filtered,
    secretsFound: [...new Set(secretsFound)],
  };
}

/**
 * Check if content contains potential secrets
 */
export function containsSecrets(content: string): boolean {
  for (const { pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      return true;
    }
  }
  return false;
}

/**
 * Filter secrets from an analysis result object
 */
export function filterAnalysisResult<T>(result: T): T {
  const json = JSON.stringify(result);
  const { filtered } = filterSecrets(json);
  return JSON.parse(filtered);
}
