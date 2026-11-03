'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';

interface MermaidDiagramProps {
  chart: string;
}

declare global {
  interface Window {
    mermaid?: {
      initialize: (config: Record<string, unknown>) => void;
      render: (id: string, text: string) => Promise<{ svg: string }>;
    };
  }
}

export default function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<string | null>('diagram');

  useEffect(() => {
    let isMounted = true;

    async function initMermaid() {
      try {
        if (!window.mermaid) {
          const script = document.createElement('script');
          script.src =
            'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
          script.async = true;
          document.head.appendChild(script);

          await new Promise<void>((resolve, reject) => {
            script.onload = () => resolve();
            script.onerror = () =>
              reject(new Error('Failed to load mermaid script'));
          });
        }

        if (window.mermaid && isMounted) {
          window.mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            securityLevel: 'loose',
            flowchart: {
              useMaxWidth: true,
              htmlLabels: true,
              curve: 'basis',
            },
          });

          const uniqueId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
          const { svg } = await window.mermaid.render(uniqueId, chart);
          if (isMounted) {
            setSvgContent(svg);
          }
        }
      } catch (err) {
        // Fallback to native SVG rendering
        if (isMounted) {
          setSvgContent(null);
        }
      }
    }

    void initMermaid();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  function handleCopy() {
    navigator.clipboard.writeText(chart).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Card withBorder padding="md" radius="md" bg="gray.0" className="shadow-sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs">
            <Badge color="blue" variant="filled">
              Architecture Mermaid Diagram
            </Badge>
            <Text size="xs" c="dimmed">
              from README.md
            </Text>
          </Group>

          <Group gap="xs">
            <Tabs value={viewMode} onChange={setViewMode} variant="pills">
              <Tabs.List>
                <Tabs.Tab value="diagram">📊 Diagram</Tabs.Tab>
                <Tabs.Tab value="code">📝 Mermaid Syntax</Tabs.Tab>
              </Tabs.List>
            </Tabs>
            <Button size="xs" variant="subtle" onClick={handleCopy}>
              {copied ? '✓ Copied' : 'Copy Code'}
            </Button>
          </Group>
        </Group>

        {viewMode === 'diagram' ? (
          <div className="bg-white rounded-lg border p-4 overflow-x-auto min-h-[380px] flex items-center justify-center">
            {svgContent ? (
              <div
                ref={containerRef}
                className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
            ) : (
              /* High-fidelity Vector SVG Fallback matching README.md diagram */
              <svg
                viewBox="0 0 920 620"
                className="w-full max-w-[880px] h-auto font-sans select-none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="8"
                    markerHeight="6"
                    refX="7"
                    refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#475569" />
                  </marker>
                  <filter
                    id="shadow"
                    x="-5%"
                    y="-5%"
                    width="110%"
                    height="115%"
                  >
                    <feDropShadow
                      dx="0"
                      dy="2"
                      stdDeviation="3"
                      floodColor="#0f172a"
                      floodOpacity="0.08"
                    />
                  </filter>
                </defs>

                {/* --- 1. USER & INGRESS NODES --- */}
                {/* Browser */}
                <g filter="url(#shadow)">
                  <rect
                    x="200"
                    y="20"
                    width="160"
                    height="42"
                    rx="6"
                    fill="#e0f2fe"
                    stroke="#0284c7"
                    strokeWidth="1.5"
                  />
                  <text
                    x="280"
                    y="46"
                    textAnchor="middle"
                    fill="#0369a1"
                    fontSize="13"
                    fontWeight="bold"
                  >
                    Browser
                  </text>
                </g>

                {/* Cognito */}
                <g filter="url(#shadow)">
                  <rect
                    x="460"
                    y="20"
                    width="220"
                    height="42"
                    rx="6"
                    fill="#fef3c7"
                    stroke="#d97706"
                    strokeWidth="1.5"
                  />
                  <text
                    x="570"
                    y="46"
                    textAnchor="middle"
                    fill="#92400e"
                    fontSize="13"
                    fontWeight="bold"
                  >
                    Amazon Cognito · sign-in
                  </text>
                </g>

                {/* Browser --> Cognito line */}
                <path
                  d="M 360 41 L 452 41"
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* CloudFront */}
                <g filter="url(#shadow)">
                  <rect
                    x="200"
                    y="100"
                    width="160"
                    height="42"
                    rx="6"
                    fill="#f3e8ff"
                    stroke="#9333ea"
                    strokeWidth="1.5"
                  />
                  <text
                    x="280"
                    y="126"
                    textAnchor="middle"
                    fill="#7e22ce"
                    fontSize="13"
                    fontWeight="bold"
                  >
                    CloudFront · HTTPS
                  </text>
                </g>

                {/* Browser --> CloudFront line */}
                <path
                  d="M 280 62 L 280 92"
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* ALB */}
                <g filter="url(#shadow)">
                  <rect
                    x="175"
                    y="175"
                    width="210"
                    height="42"
                    rx="6"
                    fill="#e0e7ff"
                    stroke="#4f46e5"
                    strokeWidth="1.5"
                  />
                  <text
                    x="280"
                    y="201"
                    textAnchor="middle"
                    fill="#3730a3"
                    fontSize="13"
                    fontWeight="bold"
                  >
                    Application Load Balancer
                  </text>
                </g>

                {/* CloudFront --> ALB line */}
                <path
                  d="M 280 142 L 280 167"
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* --- 2. ECS FARGATE COMPUTE SUBGRAPH --- */}
                <rect
                  x="40"
                  y="250"
                  width="480"
                  height="340"
                  rx="10"
                  fill="#f8fafc"
                  stroke="#cbd5e1"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
                <rect
                  x="55"
                  y="240"
                  width="220"
                  height="22"
                  rx="4"
                  fill="#334155"
                />
                <text
                  x="165"
                  y="255"
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="11"
                  fontWeight="bold"
                >
                  Compute [Amazon ECS Fargate]
                </text>

                {/* Web Node */}
                <g filter="url(#shadow)">
                  <rect
                    x="70"
                    y="280"
                    width="180"
                    height="42"
                    rx="6"
                    fill="#ecfeff"
                    stroke="#0891b2"
                    strokeWidth="1.5"
                  />
                  <text
                    x="160"
                    y="306"
                    textAnchor="middle"
                    fill="#0e7490"
                    fontSize="13"
                    fontWeight="600"
                  >
                    Web [Next.js · Mantine UI]
                  </text>
                </g>

                {/* API Node */}
                <g filter="url(#shadow)">
                  <rect
                    x="310"
                    y="280"
                    width="180"
                    height="42"
                    rx="6"
                    fill="#eff6ff"
                    stroke="#2563eb"
                    strokeWidth="1.5"
                  />
                  <text
                    x="400"
                    y="306"
                    textAnchor="middle"
                    fill="#1d4ed8"
                    fontSize="13"
                    fontWeight="600"
                  >
                    API [Fastify · REST / SSE]
                  </text>
                </g>

                {/* ALB --> Web & ALB --> API */}
                <path
                  d="M 240 217 L 160 272"
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
                <path
                  d="M 320 217 L 400 272"
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* Web --> API (authenticated requests) */}
                <path
                  d="M 250 301 L 302 301"
                  fill="none"
                  stroke="#0891b2"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
                <rect
                  x="252"
                  y="289"
                  width="48"
                  height="13"
                  rx="2"
                  fill="#ffffff"
                />
                <text
                  x="276"
                  y="298"
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="8"
                >
                  auth reqs
                </text>

                {/* Worker Node */}
                <g filter="url(#shadow)">
                  <rect
                    x="310"
                    y="375"
                    width="180"
                    height="42"
                    rx="6"
                    fill="#fef2f2"
                    stroke="#dc2626"
                    strokeWidth="1.5"
                  />
                  <text
                    x="400"
                    y="401"
                    textAnchor="middle"
                    fill="#b91c1c"
                    fontSize="13"
                    fontWeight="600"
                  >
                    Worker [BullMQ worker]
                  </text>
                </g>

                {/* Scanner Node */}
                <g filter="url(#shadow)">
                  <rect
                    x="180"
                    y="500"
                    width="230"
                    height="46"
                    rx="6"
                    fill="#fefce8"
                    stroke="#ca8a04"
                    strokeWidth="1.5"
                  />
                  <text
                    x="295"
                    y="522"
                    textAnchor="middle"
                    fill="#854d0e"
                    fontSize="12"
                    fontWeight="600"
                  >
                    Scanner [Python · Playwright]
                  </text>
                  <text
                    x="295"
                    y="537"
                    textAnchor="middle"
                    fill="#a16207"
                    fontSize="10"
                  >
                    FastMCP Tools & Reasoning
                  </text>
                </g>

                {/* Worker --> Scanner (supervised subprocess · JSON lines) */}
                <path
                  d="M 370 417 L 315 492"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
                <rect
                  x="320"
                  y="445"
                  width="145"
                  height="14"
                  rx="2"
                  fill="#ffffff"
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
                <text
                  x="392"
                  y="455"
                  textAnchor="middle"
                  fill="#475569"
                  fontSize="8"
                >
                  supervised subprocess · JSON lines
                </text>

                {/* --- 3. STATE, STORAGE & AI SERVICES --- */}
                {/* Redis */}
                <g filter="url(#shadow)">
                  <rect
                    x="580"
                    y="280"
                    width="250"
                    height="44"
                    rx="6"
                    fill="#fff1f2"
                    stroke="#e11d48"
                    strokeWidth="1.5"
                  />
                  <text
                    x="705"
                    y="307"
                    textAnchor="middle"
                    fill="#be123c"
                    fontSize="12"
                    fontWeight="bold"
                  >
                    ElastiCache Redis · queue & events
                  </text>
                </g>

                {/* API --> Redis (enqueue scan ID) */}
                <path
                  d="M 490 295 L 572 295"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
                <rect
                  x="500"
                  y="284"
                  width="65"
                  height="12"
                  rx="2"
                  fill="#ffffff"
                />
                <text
                  x="532"
                  y="293"
                  textAnchor="middle"
                  fill="#475569"
                  fontSize="8"
                >
                  enqueue scan ID
                </text>

                {/* Redis --> Worker */}
                <path
                  d="M 680 324 L 680 396 L 498 396"
                  fill="none"
                  stroke="#e11d48"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* RDS PostgreSQL DB */}
                <g filter="url(#shadow)">
                  {/* Cylinder shape */}
                  <path
                    d="M 580 380 C 580 372 630 368 705 368 C 780 368 830 372 830 380 L 830 420 C 830 428 780 432 705 432 C 630 432 580 428 580 420 Z"
                    fill="#f0fdf4"
                    stroke="#16a34a"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M 580 380 C 580 388 630 392 705 392 C 780 392 830 388 830 380"
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth="1.5"
                  />
                  <text
                    x="705"
                    y="405"
                    textAnchor="middle"
                    fill="#15803d"
                    fontSize="12"
                    fontWeight="bold"
                  >
                    RDS PostgreSQL
                  </text>
                  <text
                    x="705"
                    y="419"
                    textAnchor="middle"
                    fill="#166534"
                    fontSize="10"
                  >
                    source of truth
                  </text>
                </g>

                {/* API --> DB */}
                <path
                  d="M 460 322 L 572 380"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* Worker --> DB */}
                <path
                  d="M 490 405 L 572 405"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* S3 Evidence Artifacts */}
                <g filter="url(#shadow)">
                  <rect
                    x="580"
                    y="460"
                    width="250"
                    height="44"
                    rx="6"
                    fill="#f8fafc"
                    stroke="#475569"
                    strokeWidth="1.5"
                  />
                  <text
                    x="705"
                    y="487"
                    textAnchor="middle"
                    fill="#334155"
                    fontSize="12"
                    fontWeight="bold"
                  >
                    Private S3 · evidence artifacts
                  </text>
                </g>

                {/* Worker --> S3 */}
                <path
                  d="M 470 417 L 572 466"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />

                {/* API --> S3 (authorized proof access) */}
                <path
                  d="M 500 310 Q 560 350 590 452"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  markerEnd="url(#arrowhead)"
                />
                <rect
                  x="525"
                  y="380"
                  width="95"
                  height="13"
                  rx="2"
                  fill="#ffffff"
                />
                <text
                  x="572"
                  y="389"
                  textAnchor="middle"
                  fill="#475569"
                  fontSize="8"
                >
                  authorized proof access
                </text>

                {/* Amazon Bedrock */}
                <g filter="url(#shadow)">
                  <rect
                    x="580"
                    y="535"
                    width="250"
                    height="44"
                    rx="6"
                    fill="#faf5ff"
                    stroke="#a855f7"
                    strokeWidth="1.5"
                  />
                  <text
                    x="705"
                    y="562"
                    textAnchor="middle"
                    fill="#7e22ce"
                    fontSize="12"
                    fontWeight="bold"
                  >
                    Amazon Bedrock · summary drafts
                  </text>
                </g>

                {/* API --> Bedrock */}
                <path
                  d="M 480 322 Q 540 430 580 540"
                  fill="none"
                  stroke="#9333ea"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
              </svg>
            )}
          </div>
        ) : (
          <div className="bg-slate-900 text-slate-100 p-4 rounded-lg font-mono text-xs overflow-x-auto">
            <pre>{chart}</pre>
          </div>
        )}
      </Stack>
    </Card>
  );
}
