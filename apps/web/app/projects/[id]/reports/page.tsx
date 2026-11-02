'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import type { Project, ReportSummaryItem } from '@webops/contracts';
import { apiFetch } from '../../../../lib/client';

export default function ReportsHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<ReportSummaryItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch(`/v1/projects/${id}`),
      apiFetch(`/v1/projects/${id}/reports`),
    ])
      .then(([projectData, reportData]) => {
        setProject(projectData);
        setReports(reportData.items);
      })
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : 'Could not load reports',
        );
      })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Anchor component={Link} href={`/projects/${id}`}>
          ← {project?.name ?? 'Project'}
        </Anchor>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <Group justify="space-between" align="center">
          <Title order={1}>Report History</Title>
          <Badge size="lg">{reports.length} immutable snapshots</Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Each completed scan generates an immutable historical report.
          Snapshots preserve the coverage, issues, and evidence citations as
          they appeared at scan completion.
        </Text>
        {loading && <Loader aria-label="Loading reports" />}
        {!loading && (
          <Card withBorder>
            <Stack>
              {reports.length === 0 ? (
                <Text c="dimmed">
                  No reports generated yet. Run a scan to completion.
                </Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Generated</Table.Th>
                      <Table.Th>Visited URLs</Table.Th>
                      <Table.Th>Findings</Table.Th>
                      <Table.Th>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {reports.map((report) => (
                      <Table.Tr key={report.id}>
                        <Table.Td>
                          {new Date(report.createdAt).toLocaleString()}
                        </Table.Td>
                        <Table.Td>
                          {report.coverage.visitedUrls.length} pages
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={
                              (report.issueCount ?? 0) > 0 ? 'orange' : 'green'
                            }
                          >
                            {report.issueCount ?? 0} issues
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Anchor
                            component={Link}
                            href={`/projects/${id}/scans/${report.scanId}`}
                          >
                            View report
                          </Anchor>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </Card>
        )}
      </Stack>
    </Container>
  );
}
