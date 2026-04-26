import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from './env.js';

const execFileAsync = promisify(execFile);

export interface ClawHubSkillSearchResult {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
}

interface ClawHubSkillSearchResponse {
  results?: ClawHubSkillSearchResult[];
}

interface ClawHubSkillDetailResponse {
  skill?: {
    slug: string;
    displayName: string;
    summary?: string;
  } | null;
  latestVersion?: {
    version: string;
  } | null;
}

function resolveClawHubUrl(pathname: string, search?: Record<string, string | undefined>): URL {
  const url = new URL(pathname, `${env.CLAWHUB_BASE_URL.replace(/\/+$/, '')}/`);
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function clawHubFetchJson<T>(
  pathname: string,
  search?: Record<string, string | undefined>,
): Promise<T> {
  const response = await fetch(resolveClawHubUrl(pathname, search), {
    headers: env.CLAWHUB_TOKEN ? { Authorization: `Bearer ${env.CLAWHUB_TOKEN}` } : undefined,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`ClawHub request failed (${response.status}): ${body || response.statusText}`);
  }

  return (await response.json()) as T;
}

function resolveSkillsDir(workspaceDir = env.OPENCLAW_WORKSPACE_DIR): string {
  return path.join(path.resolve(workspaceDir), 'skills');
}

function ensureSlug(slug: string): string {
  const normalized = slug.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(normalized)) {
    throw new Error(`Invalid ClawHub skill slug: ${slug}`);
  }
  return normalized;
}

async function downloadSkillArchive(slug: string, version?: string): Promise<string> {
  const response = await fetch(
    resolveClawHubUrl('/api/v1/download', { slug, version, tag: version ? undefined : 'latest' }),
    {
      headers: env.CLAWHUB_TOKEN ? { Authorization: `Bearer ${env.CLAWHUB_TOKEN}` } : undefined,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`ClawHub download failed (${response.status}): ${body || response.statusText}`);
  }

  const archivePath = path.join(os.tmpdir(), `openclaw-wrapper-${slug}-${randomUUID()}.zip`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(archivePath, bytes);
  return archivePath;
}

async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  await execFileAsync('tar', ['-xf', archivePath, '-C', targetDir]);
}

async function resolveExtractedSkillRoot(extractDir: string): Promise<string> {
  const rootSkill = path.join(extractDir, 'SKILL.md');
  try {
    await fs.access(rootSkill);
    return extractDir;
  } catch {
    // continue
  }

  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const childDirs = entries.filter((entry) => entry.isDirectory());
  const childDir = childDirs[0];
  if (childDirs.length === 1 && childDir) {
    const candidate = path.join(extractDir, childDir.name);
    try {
      await fs.access(path.join(candidate, 'SKILL.md'));
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error('Downloaded ClawHub archive is missing SKILL.md');
}

export async function searchClawHubSkills(query?: string, limit = 12) {
  const response = await clawHubFetchJson<ClawHubSkillSearchResponse>('/api/v1/search', {
    q: query?.trim() || '*',
    limit: String(limit),
  });
  return response.results ?? [];
}

export async function installClawHubSkill(params: {
  slug: string;
  version?: string;
  workspaceDir?: string;
}) {
  const slug = ensureSlug(params.slug);
  const detail = await clawHubFetchJson<ClawHubSkillDetailResponse>(
    `/api/v1/skills/${encodeURIComponent(slug)}`,
  );
  const resolvedVersion = params.version ?? detail.latestVersion?.version;
  if (!resolvedVersion) {
    throw new Error(`Skill "${slug}" has no installable version.`);
  }

  const workspaceDir = params.workspaceDir ?? env.OPENCLAW_WORKSPACE_DIR;
  const skillsDir = resolveSkillsDir(workspaceDir);
  const targetDir = path.join(skillsDir, slug);
  const tempExtractDir = path.join(os.tmpdir(), `openclaw-wrapper-skill-${randomUUID()}`);
  const archivePath = await downloadSkillArchive(slug, resolvedVersion);

  try {
    await extractArchive(archivePath, tempExtractDir);
    const extractedRoot = await resolveExtractedSkillRoot(tempExtractDir);
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(extractedRoot, targetDir, { recursive: true });
  } finally {
    await fs.rm(tempExtractDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
  }

  return {
    slug,
    version: resolvedVersion,
    targetDir,
    displayName: detail.skill?.displayName ?? slug,
  };
}
