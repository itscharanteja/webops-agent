'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Container,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import MermaidDiagram from '../../components/mermaid-diagram';

const DEFAULT_MERMAID_CHART = `flowchart TD
    Browser[Browser] --> Cognito[Amazon Cognito · sign-in]
    Browser --> CF[CloudFront · HTTPS]
    CF --> ALB[Application Load Balancer]

    subgraph Compute[Amazon ECS Fargate]
        Web[Next.js · Mantine UI]
        API[Fastify · REST and SSE]
        Worker[BullMQ worker]
        Scanner[Python · Playwright / FastMCP]
        Worker -->|supervised subprocess · JSON lines| Scanner
    end

    ALB --> Web
    ALB --> API
    Web -->|authenticated requests| API
    API -->|enqueue scan ID| Redis[ElastiCache Redis · queue and events]
    Redis --> Worker
    API --> DB[(RDS PostgreSQL · source of truth)]
    Worker --> DB
    Worker --> S3[Private S3 · evidence artifacts]
    API -->|authorized proof access| S3
    API --> Bedrock[Amazon Bedrock · summary drafts]`;

interface AboutViewProps {
  content: string;
}

export default function AboutView({ content }: AboutViewProps) {
  const [activeTab, setActiveTab] = useState<string | null>('preview');
  const [copied, setCopied] = useState(false);
  const [runLocallyOpen, setRunLocallyOpen] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'README.md';
    link.click();
    URL.revokeObjectURL(url);
  }

  const rawLines = useMemo(() => content.split('\n'), [content]);

  const mermaidChart = useMemo(() => {
    const match = content.match(/```mermaid\n([\s\S]*?)```/);
    return match && match[1] ? match[1].trim() : DEFAULT_MERMAID_CHART;
  }, [content]);

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        {/* Navigation Breadcrumb & Header */}
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap="xs">
            <Group gap="xs">
              <Anchor component={Link} href="/projects" size="sm" c="dimmed">
                ← Back to Projects
              </Anchor>
              <Text size="sm" c="dimmed">
                /
              </Text>
              <Badge variant="light" color="blue" size="sm">
                Route: /about
              </Badge>
            </Group>
            <Title order={1}>README.md Preview</Title>
            <Text c="dimmed" size="sm">
              Official project documentation, architecture specifications, and
              implementation guidelines.
            </Text>
          </Stack>

          <Group gap="sm">
            <Button variant="default" size="sm" onClick={handleCopy}>
              {copied ? '✓ Copied' : 'Copy Markdown'}
            </Button>
            <Button
              variant="filled"
              color="blue"
              size="sm"
              onClick={handleDownload}
            >
              Download README.md
            </Button>
          </Group>
        </Group>

        {/* View Mode Tabs */}
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          variant="outline"
          radius="md"
        >
          <Tabs.List>
            <Tabs.Tab value="preview">🎨 Formatted Preview</Tabs.Tab>
            <Tabs.Tab value="raw">
              📄 Raw Markdown ({rawLines.length} lines)
            </Tabs.Tab>
          </Tabs.List>

          {/* TAB 1: RENDERED PREVIEW */}
          <Tabs.Panel value="preview" pt="lg">
            <Card
              withBorder
              padding="xl"
              radius="md"
              className="space-y-8 bg-white shadow-sm"
            >
              {/* Document Header */}
              <div className="border-b pb-6">
                <Group justify="space-between" align="center" wrap="wrap">
                  <div>
                    <Title
                      order={1}
                      className="text-3xl font-extrabold tracking-tight text-slate-900"
                    >
                      WebOps Agent
                    </Title>
                    <Text className="mt-2 text-base text-slate-600">
                      Autonomous website auditor turning real Playwright browser
                      observations into editable issues, immutable reports, and
                      cryptographic proof.
                    </Text>
                  </div>
                  <Group gap="xs">
                    <Anchor
                      href="https://d33zu6s8ozyktq.cloudfront.net"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="light" color="cyan" size="sm">
                        🚀 Open Live App (CloudFront)
                      </Button>
                    </Anchor>
                  </Group>
                </Group>
              </div>

              {/* Overview Section */}
              <Stack gap="md">
                <Title order={2} className="text-xl font-bold text-slate-800">
                  Overview
                </Title>
                <Text className="text-slate-700 leading-relaxed">
                  WebOps audits websites you own or are authorized to test. It
                  turns browser observations into editable issues with evidence,
                  live scan logs, and historical reports.
                </Text>

                {/* Collapsible Run Locally Box */}
                <Card withBorder padding="md" radius="md" bg="gray.0">
                  <Group
                    justify="space-between"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setRunLocallyOpen(!runLocallyOpen)}
                  >
                    <Group gap="xs">
                      <Text fw={600} size="sm">
                        ⚙️ Run locally setup instructions
                      </Text>
                      <Badge size="xs" variant="outline">
                        {runLocallyOpen ? 'Click to hide' : 'Click to expand'}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Node.js 22+ · pnpm 10.34 · Python 3.12 · Docker
                    </Text>
                  </Group>

                  {runLocallyOpen && (
                    <Stack gap="xs" mt="sm">
                      <Text size="sm" c="dimmed">
                        Requires Node.js 22+, pnpm 10.34.9, Python 3.12, uv
                        0.8.17, and Docker.
                      </Text>
                      <div className="bg-slate-900 text-slate-100 p-4 rounded-lg font-mono text-xs overflow-x-auto">
                        <pre>{`cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
# Configure Cognito IDs in both environment files before continuing.
docker compose up -d postgres redis fixture
corepack pnpm install --frozen-lockfile
(cd services/scanner && uv sync --frozen && uv run playwright install chromium)
corepack pnpm dev`}</pre>
                      </div>
                      <Text size="xs" c="dimmed">
                        Open <code>http://localhost:3000</code>, sign in, and
                        create a project for{' '}
                        <code>http://localhost:8080/index.html</code>. Approve{' '}
                        <code>http://localhost:8080</code> and start a scan.
                      </Text>
                    </Stack>
                  )}
                </Card>
              </Stack>

              <Divider />

              {/* Features Grid */}
              <Stack gap="md">
                <Title order={2} className="text-xl font-bold text-slate-800">
                  Core Features
                </Title>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  <Card withBorder padding="md" radius="md">
                    <Text fw={700} size="sm" c="blue.7">
                      🛡️ Bounded Scans
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      Strictly approved origins, SSRF protection, crawl budgets,
                      depth constraints, robots.txt compliance, and graceful
                      cancellation.
                    </Text>
                  </Card>

                  <Card withBorder padding="md" radius="md">
                    <Text fw={700} size="sm" c="indigo.7">
                      🔍 Evidence-Backed Issues
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      Page & link failures (4xx/5xx), uncaught JavaScript
                      errors, failed first-party API calls, WCAG accessibility
                      defects, and viewport horizontal overflow.
                    </Text>
                  </Card>

                  <Card withBorder padding="md" radius="md">
                    <Text fw={700} size="sm" c="teal.7">
                      💻 Live Developer Workspace
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      Real-time terminal log stream with reconnect support
                      (SSE), live crawler URL discovery metrics, and
                      comprehensive post-scan audit views.
                    </Text>
                  </Card>

                  <Card withBorder padding="md" radius="md">
                    <Text fw={700} size="sm" c="violet.7">
                      📋 Issue Management & Audit Trail
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      Editable titles, descriptions, priorities (P0–P3), and
                      statuses with version-checked optimistic concurrency (409
                      conflict protection) and Markdown exports.
                    </Text>
                  </Card>

                  <Card withBorder padding="md" radius="md">
                    <Text fw={700} size="sm" c="orange.7">
                      📊 Immutable Reports & Role Deliverables
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      Snapshot reports that survive later scans,
                      persona-specific markdown downloads (UI/UX, Frontend,
                      Backend, Content), and Discord webhook alerts.
                    </Text>
                  </Card>

                  <Card withBorder padding="md" radius="md">
                    <Text fw={700} size="sm" c="grape.7">
                      🧠 Amazon Bedrock AI Reasoning
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      Multimodal visual audits on desktop (1440×900) & mobile
                      (375×812) viewports with strict deterministic fallbacks on
                      model timeouts.
                    </Text>
                  </Card>
                </SimpleGrid>
              </Stack>

              <Divider />

              {/* Architecture & Mermaid Flowchart */}
              <Stack gap="md">
                <Title order={2} className="text-xl font-bold text-slate-800">
                  Architecture
                </Title>
                <Text size="sm" c="dimmed">
                  100% AWS cloud-native architecture deployed across ECS
                  Fargate, CloudFront, ALB, RDS Postgres, and ElastiCache Redis.
                </Text>

                <MermaidDiagram chart={mermaidChart} />
              </Stack>

              <Divider />

              {/* Working Process Pipeline Table */}
              <Stack gap="md">
                <Title order={2} className="text-xl font-bold text-slate-800">
                  Working Process Pipeline
                </Title>
                <Text size="sm" c="dimmed">
                  Deterministic step-by-step audit lifecycle: Scope → Crawl →
                  Check → Evidence → Report.
                </Text>

                <div className="overflow-x-auto">
                  <Table
                    striped
                    highlightOnHover
                    withTableBorder
                    withColumnBorders
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th style={{ width: '120px' }}>Step</Table.Th>
                        <Table.Th>Lifecycle Action & Sample Data</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      <Table.Tr>
                        <Table.Td>
                          <Badge color="blue" size="sm">
                            Scope
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            Base: <code>http://localhost:8080/index.html</code>;
                            Approved origin: <code>http://localhost:8080</code>
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Badge color="cyan" size="sm">
                            Queue
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            API validates scan policy, marks scan{' '}
                            <code>queued</code>, and pushes scan ID to BullMQ
                            Redis queue.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Badge color="indigo" size="sm">
                            Inspect
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            Playwright crawler navigates page, discovers
                            internal links, handles dynamic interactions, and
                            checks 4xx/5xx responses.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Badge color="violet" size="sm">
                            Check
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            Deterministic rules evaluate DOM, console logs,
                            horizontal overflow, accessibility, and broken
                            links.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Badge color="orange" size="sm">
                            Evidence
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            Persists sanitized DOM excerpt, console message,
                            network event, or screenshot crop with cryptographic
                            checksum.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Badge color="red" size="sm">
                            Issue
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            Publishes deduplicated issue with stable
                            fingerprint, reproduction steps, suggested fix, and
                            proof link.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Badge color="green" size="sm">
                            Report
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            Snapshots immutable historical report; triggers
                            persona triage (.md deliverables) and Discord
                            webhook alerts.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </div>
              </Stack>

              <Divider />

              {/* Evaluation & Test Commands */}
              <Stack gap="md">
                <Title order={2} className="text-xl font-bold text-slate-800">
                  Verification & Evals
                </Title>
                <div className="bg-slate-900 text-slate-100 p-4 rounded-lg font-mono text-xs overflow-x-auto">
                  <pre>{`corepack pnpm typecheck
corepack pnpm test
(cd services/scanner && uv run python -m unittest discover -s tests -v)
# Integration gates (requires DB, Redis, and local fixture):
node --env-file=.env scripts/test-gates.mjs all`}</pre>
                </div>
              </Stack>

              <Divider />

              {/* Known Limitations */}
              <Alert
                color="yellow"
                title="Known Limitations & Boundary Rules"
                radius="md"
              >
                <Stack gap="xs">
                  <Text size="xs">
                    • <strong>Coverage:</strong> Login, CAPTCHA, blocked CDN
                    resources, budgets, and timeouts can limit crawl coverage.
                    Zero findings does not establish complete compliance.
                  </Text>
                  <Text size="xs">
                    • <strong>Safe Form Testing:</strong> Authenticated scans
                    and destructive form submissions are blocked by default.
                  </Text>
                  <Text size="xs">
                    • <strong>Deterministic Proof Requirement:</strong> A
                    finding without verified, persisted evidence is never
                    published as an issue.
                  </Text>
                </Stack>
              </Alert>

              {/* Contributors */}
              <div className="pt-2">
                <Text size="xs" c="dimmed">
                  Maintained by <strong>AntiGravity Agents</strong> &{' '}
                  <strong>Codex</strong>.
                </Text>
              </div>
            </Card>
          </Tabs.Panel>

          {/* TAB 2: RAW MARKDOWN */}
          <Tabs.Panel value="raw" pt="lg">
            <Card withBorder padding="md" radius="md" bg="gray.0">
              <Group justify="space-between" mb="xs">
                <Text size="xs" fw={700} c="dimmed">
                  RAW README.MD SOURCE
                </Text>
                <Button size="xs" variant="subtle" onClick={handleCopy}>
                  {copied ? '✓ Copied' : 'Copy'}
                </Button>
              </Group>
              <ScrollArea h={600} type="always">
                <pre className="font-mono text-xs text-slate-800 bg-white p-4 rounded border whitespace-pre-wrap">
                  {content}
                </pre>
              </ScrollArea>
            </Card>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
