import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  EXTERNAL_PLUGIN_API_VERSION,
  type ExternalPluginManifest,
  NODE_SDK_VERSION,
  validateExternalPluginPackageJson,
} from '@openclaw-wrapper/node-sdk';
import type { NodeTypeDescriptor } from '@openclaw-wrapper/schemas';
import { env } from './env.js';

export interface PluginCatalogLoadIssue {
  pluginPath: string;
  message: string;
  code?: string;
  fieldPath?: string;
  hint?: string;
}

export interface LoadedExternalPlugin {
  directory: string;
  packageJsonPath: string;
  manifest: ExternalPluginManifest;
}

export interface LoadedPluginCatalogResult {
  plugins: LoadedExternalPlugin[];
  nodes: NodeTypeDescriptor[];
  issues: PluginCatalogLoadIssue[];
}

export const CURRENT_ADAPTER_VERSION = '0.0.0';

export function resolvePluginsDir(workspaceDir = env.OPENCLAW_WORKSPACE_DIR): string {
  return env.OPENCLAW_PLUGIN_DIR
    ? path.resolve(env.OPENCLAW_PLUGIN_DIR)
    : path.join(path.resolve(workspaceDir), 'plugins');
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

export async function loadInstalledPluginCatalog(params?: {
  pluginsDir?: string;
  reservedNodeTypes?: Iterable<string>;
  warn?: (issue: PluginCatalogLoadIssue) => void;
}): Promise<LoadedPluginCatalogResult> {
  const pluginsDir = params?.pluginsDir ?? resolvePluginsDir();
  const issues: PluginCatalogLoadIssue[] = [];
  const plugins: LoadedExternalPlugin[] = [];
  const nodes: NodeTypeDescriptor[] = [];
  const seenNodeTypes = new Set<string>();

  const entries = await fs
    .readdir(pluginsDir, { encoding: 'utf8', withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    });
  if (!entries) {
    return { plugins, nodes, issues };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(pluginsDir, entry.name);
    const packageJsonPath = path.join(directory, 'package.json');

    let packageJson: unknown;
    try {
      packageJson = await readJsonFile(packageJsonPath);
    } catch (error) {
      const issue = {
        pluginPath: packageJsonPath,
        message:
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'Plugin directory is missing package.json.'
            : `Failed to read plugin package.json: ${error instanceof Error ? error.message : 'unknown error'}`,
      } satisfies PluginCatalogLoadIssue;
      issues.push(issue);
      params?.warn?.(issue);
      continue;
    }

    const validation = validateExternalPluginPackageJson(packageJson, {
      currentAdapterVersion: CURRENT_ADAPTER_VERSION,
      currentNodeSdkVersion: NODE_SDK_VERSION,
      reservedNodeTypes: params?.reservedNodeTypes,
      supportedPluginApiVersion: EXTERNAL_PLUGIN_API_VERSION,
    });
    if (!validation.manifest || validation.issues.length > 0) {
      for (const validationIssue of validation.issues) {
        const issue = {
          pluginPath: packageJsonPath,
          code: validationIssue.code,
          fieldPath: validationIssue.fieldPath,
          message: validationIssue.message,
          hint: validationIssue.hint,
        } satisfies PluginCatalogLoadIssue;
        issues.push(issue);
        params?.warn?.(issue);
      }
      continue;
    }

    const pluginNodes: NodeTypeDescriptor[] = [];
    for (const node of validation.manifest.nodes) {
      if (seenNodeTypes.has(node.type)) {
        const issue = {
          pluginPath: packageJsonPath,
          code: 'node-type-duplicate',
          fieldPath: 'openclawWrapper.nodes',
          message: `Node type "${node.type}" is already registered by another external plugin.`,
          hint: 'Rename the plugin node type so only one external plugin claims that type.',
        } satisfies PluginCatalogLoadIssue;
        issues.push(issue);
        params?.warn?.(issue);
        continue;
      }

      seenNodeTypes.add(node.type);
      pluginNodes.push(structuredClone(node));
      nodes.push(structuredClone(node));
    }

    plugins.push({
      directory,
      packageJsonPath,
      manifest: {
        ...validation.manifest,
        nodes: pluginNodes,
      },
    });
  }

  return { plugins, nodes, issues };
}
