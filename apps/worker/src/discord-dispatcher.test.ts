import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DiscordDispatcherService } from './discord-dispatcher.js';

describe('DiscordDispatcherService', () => {
  let dispatcher: DiscordDispatcherService;

  beforeEach(() => {
    dispatcher = new DiscordDispatcherService();
  });

  describe('validateDiscordWebhookUrl', () => {
    it('accepts valid discord webhook URLs', () => {
      expect(
        dispatcher.validateDiscordWebhookUrl(
          'https://discord.com/api/webhooks/123456789/abcdefgh',
        ),
      ).toBe(true);
      expect(
        dispatcher.validateDiscordWebhookUrl(
          'https://discordapp.com/api/webhooks/123456789/abcdefgh',
        ),
      ).toBe(true);
      expect(
        dispatcher.validateDiscordWebhookUrl(
          'https://canary.discord.com/api/webhooks/123456789/abcdefgh',
        ),
      ).toBe(true);
    });

    it('rejects SSRF attempts and non-discord domains', () => {
      expect(
        dispatcher.validateDiscordWebhookUrl(
          'http://discord.com/api/webhooks/123',
        ),
      ).toBe(false);
      expect(
        dispatcher.validateDiscordWebhookUrl(
          'https://evil.com/api/webhooks/123',
        ),
      ).toBe(false);
      expect(
        dispatcher.validateDiscordWebhookUrl(
          'https://169.254.169.254/latest/meta-data',
        ),
      ).toBe(false);
      expect(
        dispatcher.validateDiscordWebhookUrl(
          'https://localhost:8080/api/webhooks/123',
        ),
      ).toBe(false);
      expect(
        dispatcher.validateDiscordWebhookUrl('https://discord.com/other/path'),
      ).toBe(false);
      expect(dispatcher.validateDiscordWebhookUrl('not-a-url')).toBe(false);
    });
  });

  describe('getColorForTrack', () => {
    it('returns red for P0 regardless of track', () => {
      expect(dispatcher.getColorForTrack('ui_ux', 'P0')).toBe(0xdc2626);
      expect(dispatcher.getColorForTrack('content_seo', 'P0')).toBe(0xdc2626);
    });

    it('returns track-specific colors for non-P0', () => {
      expect(dispatcher.getColorForTrack('ui_ux', 'P2')).toBe(0x7c3aed);
      expect(dispatcher.getColorForTrack('frontend', 'P1')).toBe(0x2563eb);
      expect(dispatcher.getColorForTrack('backend', 'P2')).toBe(0xdc2626);
      expect(dispatcher.getColorForTrack('content_seo', 'P3')).toBe(0x059669);
    });
  });

  describe('dispatchFinding', () => {
    it('constructs rich embed and posts to Discord', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 204,
        headers: new Headers(),
      });
      global.fetch = mockFetch;

      const finding = {
        issueId: 'iss-1',
        title: 'Contrast failure on button',
        priority: 'P2' as const,
        pageUrl: 'https://example.com',
        ruleId: 'CONTRAST_DEFECT',
        targetPersona: 'ui_ux' as const,
        observedFacts: 'Ratio 2.8:1',
        suggestedFix: 'Darken fill to #2B6CB0',
        remediationAdvice: {
          concreteFix: 'Darken fill to #2B6CB0',
          codeOrTokenSnippet: 'color: #FFFFFF;',
        },
      };

      const success = await dispatcher.dispatchFinding(
        'https://discord.com/api/webhooks/123/abc',
        finding,
        'https://app.webops.dev/proof/1',
      );

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0]!;
      const body = JSON.parse(call[1].body);
      expect(body.username).toContain('UI/UX Design Auditor');
      expect(body.embeds[0].title).toBe('[P2] Contrast failure on button');
      expect(body.embeds[0].color).toBe(0x7c3aed);
      expect(
        body.embeds[0].fields.some((f: any) => f.name.includes('Remediation')),
      ).toBe(true);
    });

    it('retries on 429 rate limit', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ 'retry-after': '0.01' }),
        })
        .mockResolvedValueOnce({
          status: 204,
          headers: new Headers(),
        });
      global.fetch = mockFetch;

      const finding = {
        issueId: 'iss-1',
        title: 'Server Error 500',
        priority: 'P0' as const,
        pageUrl: 'https://example.com/api',
        ruleId: 'HTTP_PAGE_ERROR',
        targetPersona: 'backend' as const,
        observedFacts: 'Status 500',
        suggestedFix: 'Fix crash',
      };

      const success = await dispatcher.dispatchFinding(
        'https://discord.com/api/webhooks/123/abc',
        finding,
        'https://app.webops.dev/proof/1',
      );

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
