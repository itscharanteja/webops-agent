import type { TargetPersona, PersonaPackageSummary } from './index.js';

export interface ScanContext {
  id: string;
  projectId: string;
  projectBaseUrl: string;
}

export interface FindingWithPersona {
  issueId: string;
  fingerprint: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status: string;
  affectedUrl: string | null;
  ruleId: string;
  targetPersona: TargetPersona;
  observed: string;
  impact: string;
  reproductionSteps: string[];
  suggestedFix: string;
  remediationAdvice?: {
    headline?: string;
    impactAssessment?: string;
    concreteFix?: string;
    codeOrTokenSnippet?: string;
    evidenceCitations?: string[];
  };
  evidenceIds: string[];
}

export class PersonaTriageService {
  /**
   * Deterministically categorize an issue finding into its primary owner discipline.
   */
  classify(ruleId: string, facts: Record<string, unknown> = {}): TargetPersona {
    // 1. UI / UX Design & Layout
    if (
      ruleId === 'HORIZONTAL_OVERFLOW' ||
      ruleId === 'CONTRAST_DEFECT' ||
      ruleId === 'VISUAL_OVERLAP_CLIPPING' ||
      ruleId === 'UX_CONVERSION_FRICTION'
    ) {
      return 'ui_ux';
    }

    // 2. Server & Infrastructure
    if (
      ruleId === 'FAILED_FIRST_PARTY_REQUEST' ||
      ruleId === 'SLOW_TTFB' ||
      (ruleId === 'HTTP_PAGE_ERROR' &&
        (facts.status === null ||
          facts.status === undefined ||
          Number(facts.status) >= 500))
    ) {
      return 'backend';
    }

    // 3. Content & Metadata (SEO / Accessibility)
    if (ruleId === 'MISSING_PAGE_TITLE' || ruleId === 'MISSING_IMAGE_ALT') {
      return 'content_seo';
    }

    // 4. Default to Frontend Engineer (DOM, uncaught JS, 4xx broken links, client hydration)
    return 'frontend';
  }

  /**
   * Generate persona-specific Markdown package.
   */
  generateMarkdownPackage(
    scan: ScanContext,
    persona: TargetPersona,
    findings: FindingWithPersona[],
  ): string {
    const personaFindings = findings.filter((f) => f.targetPersona === persona);

    const personaTitles: Record<TargetPersona, string> = {
      ui_ux: '🎨 UI/UX Design Audit & Token Remediation Spec',
      frontend: '💻 Frontend Engineering Issue Tasklist',
      backend: '⚙️ Backend Incident & SRE Operational Runbook',
      content_seo: '📝 Content Strategy & Accessibility Checklist',
    };

    const lines: string[] = [
      `# ${personaTitles[persona]}`,
      `- **Audited Domain:** \`${scan.projectBaseUrl}\``,
      `- **Scan ID:** \`${scan.id}\``,
      `- **Generated:** ${new Date().toISOString()}`,
      `- **Total Issues in Track:** ${personaFindings.length}`,
      ``,
      `---`,
      ``,
    ];

    if (personaFindings.length === 0) {
      lines.push(
        `> [!NOTE]`,
        `> **Zero Defects Detected:** No actionable findings were discovered for this discipline during this audit. Quality benchmarks are satisfied.`,
        ``,
      );
      return lines.join('\n');
    }

    personaFindings.forEach((item, idx) => {
      lines.push(
        `## ${idx + 1}. [${item.priority}] ${item.title}`,
        `- **Affected URL:** \`${item.affectedUrl ?? scan.projectBaseUrl}\``,
        `- **Rule ID:** \`${item.ruleId}\``,
        ``,
        `### Observed Facts`,
        item.observed,
        ``,
        `### Impact Assessment`,
        item.impact,
        ``,
      );

      if (item.reproductionSteps && item.reproductionSteps.length > 0) {
        lines.push(`### Reproduction Steps`);
        item.reproductionSteps.forEach((step, sIdx) => {
          lines.push(`${sIdx + 1}. ${step}`);
        });
        lines.push(``);
      }

      lines.push(
        `### Concrete Remediation Guidance`,
        item.remediationAdvice?.concreteFix ?? item.suggestedFix,
        ``,
      );

      if (item.remediationAdvice?.codeOrTokenSnippet) {
        lines.push(
          '```text',
          item.remediationAdvice.codeOrTokenSnippet,
          '```',
          '',
        );
      }

      if (item.evidenceIds && item.evidenceIds.length > 0) {
        lines.push(`### Cryptographic Stored Proof`);
        item.evidenceIds.forEach((eid) => {
          lines.push(`- Evidence ID: \`${eid}\``);
          lines.push(
            `- Verification Route: \`/projects/${scan.projectId}/scans/${scan.id}/evidence/${eid}\``,
          );
        });
        lines.push(``);
      }

      lines.push(`---`, ``);
    });

    return lines.join('\n');
  }

  /**
   * Produce summary metadata for each persona track.
   */
  summarizePackages(
    findings: FindingWithPersona[],
  ): Record<TargetPersona, PersonaPackageSummary> {
    const personas: TargetPersona[] = [
      'ui_ux',
      'frontend',
      'backend',
      'content_seo',
    ];
    const titles: Record<TargetPersona, string> = {
      ui_ux: 'UI/UX Design Specification & Remediation Guide',
      frontend: 'Frontend Engineering Task Backlog',
      backend: 'Backend Incident Runbook & Network Trace Report',
      content_seo: 'Content Accessibility & SEO Meta Checklist',
    };

    const summaries = {} as Record<TargetPersona, PersonaPackageSummary>;

    for (const persona of personas) {
      const matching = findings.filter((f) => f.targetPersona === persona);
      const criticalCount = matching.filter(
        (f) => f.priority === 'P0' || f.priority === 'P1',
      ).length;

      summaries[persona] = {
        persona,
        title: titles[persona],
        issueCount: matching.length,
        criticalCount,
      };
    }

    return summaries;
  }
}
