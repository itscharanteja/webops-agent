import { describe, expect, it } from 'vitest';
import { PersonaTriageService } from './persona-triage.js';

describe('PersonaTriageService', () => {
  const triage = new PersonaTriageService();

  describe('classify', () => {
    it('classifies visual and layout rules to ui_ux', () => {
      expect(triage.classify('HORIZONTAL_OVERFLOW')).toBe('ui_ux');
      expect(triage.classify('CONTRAST_DEFECT')).toBe('ui_ux');
      expect(triage.classify('VISUAL_OVERLAP_CLIPPING')).toBe('ui_ux');
      expect(triage.classify('UX_CONVERSION_FRICTION')).toBe('ui_ux');
    });

    it('classifies server failures to backend', () => {
      expect(triage.classify('FAILED_FIRST_PARTY_REQUEST')).toBe('backend');
      expect(triage.classify('SLOW_TTFB')).toBe('backend');
      expect(triage.classify('HTTP_PAGE_ERROR', { status: 500 })).toBe(
        'backend',
      );
      expect(triage.classify('HTTP_PAGE_ERROR', { status: 502 })).toBe(
        'backend',
      );
      expect(triage.classify('HTTP_PAGE_ERROR', { status: 503 })).toBe(
        'backend',
      );
      expect(triage.classify('HTTP_PAGE_ERROR', { status: null })).toBe(
        'backend',
      );
    });

    it('classifies 4xx page error to frontend', () => {
      expect(triage.classify('HTTP_PAGE_ERROR', { status: 404 })).toBe(
        'frontend',
      );
      expect(triage.classify('HTTP_PAGE_ERROR', { status: 403 })).toBe(
        'frontend',
      );
    });

    it('classifies content and metadata rules to content_seo', () => {
      expect(triage.classify('MISSING_PAGE_TITLE')).toBe('content_seo');
      expect(triage.classify('MISSING_IMAGE_ALT')).toBe('content_seo');
    });

    it('classifies client-side DOM and scripts to frontend', () => {
      expect(triage.classify('UNLABELED_FORM_CONTROL')).toBe('frontend');
      expect(triage.classify('JS_CONSOLE_ERROR')).toBe('frontend');
      expect(triage.classify('BROKEN_INTERNAL_LINK')).toBe('frontend');
      expect(triage.classify('BROKEN_VISUAL_STATE')).toBe('frontend');
    });
  });

  describe('generateMarkdownPackage', () => {
    it('generates rich markdown package for a persona track', () => {
      const scan = {
        id: 'scan-123',
        projectId: 'proj-456',
        projectBaseUrl: 'https://example.com',
      };
      const findings = [
        {
          issueId: 'iss-1',
          fingerprint: 'fp-1',
          title: 'Button contrast below WCAG AA',
          description: 'Contrast is 2.8:1',
          priority: 'P2' as const,
          status: 'open',
          affectedUrl: 'https://example.com/pricing',
          ruleId: 'CONTRAST_DEFECT',
          targetPersona: 'ui_ux' as const,
          observed: 'Observed contrast 2.8:1 fails AA requirement',
          impact: 'Users with visual impairments cannot read the button',
          reproductionSteps: ['Navigate to pricing', 'Inspect CTA button'],
          suggestedFix: 'Darken background color to #2B6CB0',
          remediationAdvice: {
            concreteFix: 'Shift background fill to #2B6CB0',
            codeOrTokenSnippet: 'color: #FFFFFF; background-color: #2B6CB0;',
          },
          evidenceIds: ['ev-100'],
        },
      ];

      const md = triage.generateMarkdownPackage(scan, 'ui_ux', findings);
      expect(md).toContain('# 🎨 UI/UX Design Audit & Token Remediation Spec');
      expect(md).toContain('Button contrast below WCAG AA');
      expect(md).toContain('Shift background fill to #2B6CB0');
      expect(md).toContain('ev-100');
      expect(md).toContain('/projects/proj-456/scans/scan-123/evidence/ev-100');
    });

    it('handles empty findings track cleanly', () => {
      const scan = {
        id: 'scan-123',
        projectId: 'proj-456',
        projectBaseUrl: 'https://example.com',
      };
      const md = triage.generateMarkdownPackage(scan, 'backend', []);
      expect(md).toContain('Zero Defects Detected');
    });
  });

  describe('summarizePackages', () => {
    it('correctly tallies issues and critical counts', () => {
      const findings = [
        {
          issueId: 'iss-1',
          fingerprint: 'fp-1',
          title: '500 Server error',
          description: '',
          priority: 'P0' as const,
          status: 'open',
          affectedUrl: 'https://example.com/api',
          ruleId: 'HTTP_PAGE_ERROR',
          targetPersona: 'backend' as const,
          observed: '',
          impact: '',
          reproductionSteps: [],
          suggestedFix: '',
          evidenceIds: [],
        },
        {
          issueId: 'iss-2',
          fingerprint: 'fp-2',
          title: '404 Link',
          description: '',
          priority: 'P1' as const,
          status: 'open',
          affectedUrl: 'https://example.com/about',
          ruleId: 'BROKEN_INTERNAL_LINK',
          targetPersona: 'frontend' as const,
          observed: '',
          impact: '',
          reproductionSteps: [],
          suggestedFix: '',
          evidenceIds: [],
        },
      ];

      const summaries = triage.summarizePackages(findings);
      expect(summaries.backend.issueCount).toBe(1);
      expect(summaries.backend.criticalCount).toBe(1);
      expect(summaries.frontend.issueCount).toBe(1);
      expect(summaries.frontend.criticalCount).toBe(1);
      expect(summaries.ui_ux.issueCount).toBe(0);
      expect(summaries.content_seo.issueCount).toBe(0);
    });
  });
});
