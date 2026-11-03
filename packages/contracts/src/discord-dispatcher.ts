import type { TargetPersona, ProjectDiscordConfig } from './index.js';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  url?: string | undefined;
  description?: string | undefined;
  color: number;
  fields: DiscordEmbedField[];
  image?: { url: string } | undefined;
  thumbnail?: { url: string } | undefined;
  footer?: { text: string } | undefined;
  timestamp?: string | undefined;
}

export interface DiscordWebhookPayload {
  username: string;
  avatar_url?: string | undefined;
  content?: string | undefined;
  embeds: DiscordEmbed[];
}

export interface FindingDispatchItem {
  issueId: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  pageUrl: string | null;
  ruleId: string;
  targetPersona: TargetPersona;
  observedFacts: string;
  suggestedFix: string;
  remediationAdvice?: {
    headline?: string;
    concreteFix?: string;
    codeOrTokenSnippet?: string;
  };
}

export class DiscordDispatcherService {
  /**
   * Validate that the webhook URL belongs to an authentic Discord webhook endpoint
   * to protect against SSRF and unauthorized network requests.
   */
  validateDiscordWebhookUrl(urlStr: string): boolean {
    try {
      const url = new URL(urlStr);
      if (url.protocol !== 'https:') return false;
      const hostname = url.hostname.toLowerCase();
      if (
        hostname !== 'discord.com' &&
        hostname !== 'discordapp.com' &&
        hostname !== 'canary.discord.com' &&
        hostname !== 'ptb.discord.com'
      ) {
        return false;
      }
      return url.pathname.startsWith('/api/webhooks/');
    } catch {
      return false;
    }
  }

  getColorForTrack(persona: TargetPersona, priority: string): number {
    if (priority === 'P0') return 0xdc2626; // Crimson Red for P0
    const colorMap: Record<TargetPersona, number> = {
      ui_ux: 0x7c3aed, // Violet Purple
      frontend: 0x2563eb, // Cobalt Blue
      backend: 0xdc2626, // Crimson Red
      content_seo: 0x059669, // Emerald Green
    };
    return colorMap[persona] ?? 0x4b5563;
  }

  getAvatarForPersona(persona: TargetPersona): string {
    const avatarMap: Record<TargetPersona, string> = {
      ui_ux:
        'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/png/figma.png',
      frontend:
        'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/png/react.png',
      backend:
        'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/png/prometheus.png',
      content_seo:
        'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/png/google-cloud.png',
    };
    return avatarMap[persona];
  }

  /**
   * Post payload to Discord with automatic rate limit handling (429).
   */
  async postToDiscord(
    webhookUrl: string,
    payload: DiscordWebhookPayload,
    maxRetries = 2,
  ): Promise<boolean> {
    if (!this.validateDiscordWebhookUrl(webhookUrl)) {
      throw new Error(
        'Invalid Discord webhook URL. URL must start with https://discord.com/api/webhooks/',
      );
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.status === 204 || response.status === 200) {
          return true;
        }

        if (response.status === 429) {
          const retryHeader = response.headers.get('retry-after');
          const delaySec = retryHeader ? Math.min(Number(retryHeader), 5) : 1;
          await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
          continue;
        }

        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Discord API returned HTTP ${response.status}: ${errorText.slice(0, 300)}`,
        );
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    return false;
  }

  /**
   * Dispatch a single finding to Discord.
   */
  async dispatchFinding(
    webhookUrl: string,
    finding: FindingDispatchItem,
    proofUrl: string,
    screenshotCropUrl?: string,
  ): Promise<boolean> {
    const color = this.getColorForTrack(
      finding.targetPersona,
      finding.priority,
    );
    const personaNames: Record<TargetPersona, string> = {
      ui_ux: 'UI/UX Design Auditor',
      frontend: 'Frontend Engineering Auditor',
      backend: 'Backend & SRE Incident Guardian',
      content_seo: 'Content & SEO Specialist',
    };

    const fields: DiscordEmbedField[] = [];

    const fixText =
      finding.remediationAdvice?.concreteFix ??
      finding.suggestedFix ??
      'Inspect affected element and resolve defect.';
    fields.push({
      name: '🛠️ Recommended Remediation',
      value: fixText.slice(0, 1024),
      inline: false,
    });

    if (finding.remediationAdvice?.codeOrTokenSnippet) {
      fields.push({
        name: '💻 Token / Code Snippet',
        value: `\`\`\`text\n${finding.remediationAdvice.codeOrTokenSnippet.slice(0, 1000)}\n\`\`\``,
        inline: false,
      });
    }

    fields.push({
      name: '🔍 Stored Proof Citation',
      value: `[Open Interactive Proof Viewer](${proofUrl})`,
      inline: true,
    });

    const isHighUrgency =
      finding.priority === 'P0' ||
      (finding.priority === 'P1' && finding.targetPersona === 'backend');

    const embed: DiscordEmbed = {
      title: `[${finding.priority}] ${finding.title}`.slice(0, 256),
      url: proofUrl,
      description:
        `**Affected URL:** \`${finding.pageUrl ?? 'Site-wide'}\`\n**Observed:** ${finding.observedFacts}`.slice(
          0,
          2048,
        ),
      color,
      fields,
      ...(screenshotCropUrl ? { image: { url: screenshotCropUrl } } : {}),
      footer: { text: `WebOps Auditor • Rule: ${finding.ruleId}` },
      timestamp: new Date().toISOString(),
    };

    return this.postToDiscord(webhookUrl, {
      username: `WebOps [${personaNames[finding.targetPersona] ?? 'Auditor'}]`,
      avatar_url: this.getAvatarForPersona(finding.targetPersona),
      content: isHighUrgency
        ? `🚨 **High Severity Defect Detected [${finding.priority}]**`
        : undefined,
      embeds: [embed],
    });
  }

  /**
   * Dispatch track summary or test ping.
   */
  async sendTestPing(
    webhookUrl: string,
    track: TargetPersona | 'general',
  ): Promise<boolean> {
    const trackLabels: Record<string, string> = {
      ui_ux: '🎨 UI/UX Design & Token Track',
      frontend: '💻 Frontend Engineering Track',
      backend: '⚙️ Backend & SRE Alerts Track',
      content_seo: '📝 Content & SEO Meta Track',
      general: '🛡️ WebOps General Audit Channel',
    };

    const color =
      track === 'backend'
        ? 0xdc2626
        : track === 'ui_ux'
          ? 0x7c3aed
          : track === 'content_seo'
            ? 0x059669
            : 0x2563eb;

    const embed: DiscordEmbed = {
      title: `✅ Discord Webhook Connected: ${trackLabels[track] ?? track}`,
      description: `WebOps Audit Engine has successfully verified connectivity to this channel. Role-tailored deliverables and actionable defect tickets will be dispatched here.`,
      color,
      fields: [
        {
          name: '📡 Channel Status',
          value: '`Active & Ready`',
          inline: true,
        },
        {
          name: '⏱️ Timestamp',
          value: new Date().toISOString(),
          inline: true,
        },
      ],
      footer: { text: 'WebOps Agentic Workflow • Post-Scan Autonomous Triage' },
      timestamp: new Date().toISOString(),
    };

    return this.postToDiscord(webhookUrl, {
      username: 'WebOps Dispatcher',
      embeds: [embed],
    });
  }

  /**
   * Dispatch a role package summary to its configured webhook channel.
   */
  async dispatchTrackPackage(
    webhookUrl: string,
    scanId: string,
    projectId: string,
    persona: TargetPersona,
    issueCount: number,
    criticalCount: number,
    appBaseUrl: string,
  ): Promise<boolean> {
    const personaTitles: Record<TargetPersona, string> = {
      ui_ux: '🎨 UI/UX Design Audit & Token Remediation Spec',
      frontend: '💻 Frontend Engineering Issue Tasklist',
      backend: '⚙️ Backend Incident & SRE Operational Runbook',
      content_seo: '📝 Content Strategy & Accessibility Checklist',
    };

    const color = this.getColorForTrack(
      persona,
      criticalCount > 0 ? 'P0' : 'P2',
    );
    const reportUrl = `${appBaseUrl}/projects/${projectId}/scans/${scanId}`;

    const embed: DiscordEmbed = {
      title: `📦 ${personaTitles[persona]}`,
      url: reportUrl,
      description:
        issueCount === 0
          ? '🎉 **Zero defects detected in this discipline!** All quality benchmarks satisfied.'
          : `Audit completed with **${issueCount} defect(s)** discovered (${criticalCount} critical P0/P1).`,
      color,
      fields: [
        {
          name: '📊 Total Issues',
          value: `\`${issueCount}\``,
          inline: true,
        },
        {
          name: '🔥 Critical P0/P1',
          value: `\`${criticalCount}\``,
          inline: true,
        },
        {
          name: '📑 Full Report & Deliverables',
          value: `[Open Interactive Report](${reportUrl})`,
          inline: false,
        },
      ],
      footer: { text: `WebOps Audit • Scan #${scanId.slice(0, 8)}` },
      timestamp: new Date().toISOString(),
    };

    return this.postToDiscord(webhookUrl, {
      username: `WebOps [${persona.toUpperCase()} Squad]`,
      avatar_url: this.getAvatarForPersona(persona),
      embeds: [embed],
    });
  }
}
