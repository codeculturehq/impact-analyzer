import { describe, it, expect } from 'vitest';
import { filterSecrets, containsSecrets, filterAnalysisResult } from '../../src/llm/secrets-filter.js';

describe('Secrets Filter', () => {
  describe('filterSecrets', () => {
    it('should filter API keys', () => {
      const input = 'const apiKey = "sk_test_abcdefghijklmnopqrstuvwxyz123456"';
      const result = filterSecrets(input);

      expect(result.filtered).not.toContain('sk_test_');
      expect(result.secretsFound).toContain('Stripe Key');
    });

    it('should filter AWS credentials', () => {
      const input = `
        AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
        AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      `;
      const result = filterSecrets(input);

      expect(result.filtered).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(result.filtered).not.toContain('wJalrXUtnFEMI');
      expect(result.secretsFound).toContain('AWS Access Key');
      expect(result.secretsFound).toContain('AWS Secret Key');
    });

    it('should filter JWT tokens', () => {
      const input = 'token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = filterSecrets(input);

      expect(result.filtered).toContain('[REDACTED JWT]');
      expect(result.secretsFound).toContain('JWT');
    });

    it('should filter private keys', () => {
      const input = `
-----BEGIN RSA PRIVATE KEY-----
MIIEpQIBAAKCAQEA0Z3US
-----END RSA PRIVATE KEY-----
      `;
      const result = filterSecrets(input);

      expect(result.filtered).toContain('[REDACTED Private Key]');
      expect(result.secretsFound).toContain('Private Key');
    });

    it('should filter GitHub tokens', () => {
      const input = 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890';
      const result = filterSecrets(input);

      expect(result.filtered).not.toContain('ghp_');
      expect(result.secretsFound).toContain('GitHub Token');
    });

    it('should filter Slack tokens', () => {
      const input = 'slack_token: xoxb-1234567890-abcdefghijkl';
      const result = filterSecrets(input);

      expect(result.filtered).not.toContain('xoxb-');
      expect(result.secretsFound).toContain('Slack Token');
    });

    it('should filter Slack webhooks', () => {
      // Build webhook URL dynamically to avoid GitHub secret scanning
      const slackDomain = ['hooks', 'slack', 'com'].join('.');
      const input = `webhook: https://${slackDomain}/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx`;
      const result = filterSecrets(input);

      expect(result.filtered).not.toContain(slackDomain);
      expect(result.secretsFound).toContain('Slack Webhook');
    });

    it('should filter database URLs', () => {
      const input = 'DATABASE_URL = "postgres://user:password@localhost:5432/db"';
      const result = filterSecrets(input);

      expect(result.filtered).toContain('[REDACTED Database URL]');
      expect(result.secretsFound).toContain('Database URL');
    });

    it('should filter passwords', () => {
      const input = 'password: "mysecretpassword123"';
      const result = filterSecrets(input);

      expect(result.filtered).not.toContain('mysecretpassword123');
      expect(result.secretsFound).toContain('Password');
    });

    it('should not modify content without secrets', () => {
      const input = 'const message = "Hello, world!";';
      const result = filterSecrets(input);

      expect(result.filtered).toBe(input);
      expect(result.secretsFound).toHaveLength(0);
    });

    it('should deduplicate found secret types', () => {
      const input = `
        api_key: "key123456789012345678901234"
        API_KEY: "key987654321098765432109876"
      `;
      const result = filterSecrets(input);

      // Should only list API Key once even if found multiple times
      const apiKeyCount = result.secretsFound.filter(s => s === 'API Key').length;
      expect(apiKeyCount).toBeLessThanOrEqual(1);
    });
  });

  describe('containsSecrets', () => {
    it('should return true when secrets are present', () => {
      expect(containsSecrets('api_key: "sk_test_abc123def456ghi789"')).toBe(true);
      expect(containsSecrets('ghp_abcdefghijklmnopqrstuvwxyz1234567890')).toBe(true);
    });

    it('should return false when no secrets are present', () => {
      expect(containsSecrets('const x = 42;')).toBe(false);
      expect(containsSecrets('Hello world')).toBe(false);
    });
  });

  describe('filterAnalysisResult', () => {
    it('should filter secrets from nested object', () => {
      const result = {
        meta: { timestamp: '2024-01-01' },
        repos: [
          {
            name: 'test',
            impacts: [
              {
                component: 'ApiService',
                file: 'api.ts',
                reasons: [
                  {
                    type: 'direct',
                    source: 'api.ts',
                    description: 'API key changed: sk_test_abcdefghijklmnopqrstuvwxyz123456',
                  },
                ],
              },
            ],
          },
        ],
      };

      const filtered = filterAnalysisResult(result);

      expect(JSON.stringify(filtered)).not.toContain('sk_test_');
      expect(JSON.stringify(filtered)).toContain('[REDACTED');
    });
  });
});
