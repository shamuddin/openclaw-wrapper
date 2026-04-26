import { NodeTypeDescriptor } from '@openclaw-wrapper/schemas';
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

type JsonObject = Record<string, unknown>;

export const EXTERNAL_PLUGIN_API_VERSION = '1.0.0';
export const NODE_SDK_VERSION = '0.0.0';

export const ExternalPluginCompatibility = Type.Object({
  pluginApi: Type.String({ minLength: 1 }),
  minAdapterVersion: Type.Optional(Type.String({ minLength: 1 })),
  builtWithAdapterVersion: Type.Optional(Type.String({ minLength: 1 })),
  nodeSdkVersion: Type.Optional(Type.String({ minLength: 1 })),
});
export type ExternalPluginCompatibility = Static<typeof ExternalPluginCompatibility>;

export const ExternalPluginManifest = Type.Object({
  name: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  displayName: Type.Optional(Type.String({ minLength: 1 })),
  description: Type.Optional(Type.String()),
  compat: ExternalPluginCompatibility,
  nodes: Type.Array(NodeTypeDescriptor, { minItems: 1 }),
});
export type ExternalPluginManifest = Static<typeof ExternalPluginManifest>;

export type ExternalPluginValidationIssue = {
  fieldPath: string;
  message: string;
  code?: string;
  hint?: string;
};

export type ExternalPluginValidationOptions = {
  currentAdapterVersion?: string;
  currentNodeSdkVersion?: string;
  reservedNodeTypes?: Iterable<string>;
  supportedPluginApiVersion?: string;
};

export type ExternalPluginValidationResult = {
  manifest?: ExternalPluginManifest;
  issues: ExternalPluginValidationIssue[];
};

export const EXTERNAL_PLUGIN_REQUIRED_FIELD_PATHS = [
  'name',
  'version',
  'openclawWrapper.compat.pluginApi',
  'openclawWrapper.nodes',
] as const;

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseVersion(value: string | undefined): ParsedVersion | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) {
    return undefined;
  }

  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function isPluginApiCompatible(range: string | undefined, supportedVersion: string): boolean {
  const requested = normalizeOptionalString(range);
  if (!requested) {
    return false;
  }

  const supported = parseVersion(supportedVersion);
  if (!supported) {
    return false;
  }

  if (requested.startsWith('^')) {
    const minimum = parseVersion(requested.slice(1));
    if (!minimum) {
      return false;
    }
    return minimum.major === supported.major && compareVersions(supported, minimum) >= 0;
  }

  const exact = parseVersion(requested);
  if (!exact) {
    return false;
  }

  return compareVersions(exact, supported) === 0;
}

function readPluginBlock(packageJson: unknown) {
  const root = isRecord(packageJson) ? packageJson : undefined;
  const plugin = isRecord(root?.openclawWrapper) ? root.openclawWrapper : undefined;
  const compat = isRecord(plugin?.compat) ? plugin.compat : undefined;
  const rawNodes = Array.isArray(plugin?.nodes) ? plugin.nodes : undefined;
  return { root, plugin, compat, rawNodes };
}

function normalizePluginNodes(rawNodes: unknown[] | undefined): {
  nodes: ExternalPluginManifest['nodes'];
  issues: ExternalPluginValidationIssue[];
} {
  if (!rawNodes || rawNodes.length === 0) {
    return {
      nodes: [],
      issues: [
        {
          fieldPath: 'openclawWrapper.nodes',
          message: 'openclawWrapper.nodes must contain at least one node descriptor.',
          code: 'nodes-missing',
          hint: 'Add at least one valid NodeTypeDescriptor entry under openclawWrapper.nodes.',
        },
      ],
    };
  }

  const issues: ExternalPluginValidationIssue[] = [];
  const nodes: ExternalPluginManifest['nodes'] = [];
  const seenNodeTypes = new Set<string>();

  for (const [index, rawNode] of rawNodes.entries()) {
    if (!isRecord(rawNode)) {
      issues.push({
        fieldPath: `openclawWrapper.nodes[${index}]`,
        message: 'Each plugin node must be an object.',
        code: 'node-invalid',
      });
      continue;
    }

    const normalizedNode = {
      ...rawNode,
      source: 'external-plugin' as const,
    };

    if (!Value.Check(NodeTypeDescriptor, normalizedNode)) {
      const first = Value.Errors(NodeTypeDescriptor, normalizedNode).First();
      issues.push({
        fieldPath: `openclawWrapper.nodes[${index}]${first?.path ?? ''}`,
        message: first?.message ?? 'Invalid node descriptor.',
        code: 'node-invalid',
      });
      continue;
    }

    if (seenNodeTypes.has(normalizedNode.type)) {
      issues.push({
        fieldPath: `openclawWrapper.nodes[${index}].type`,
        message: `Duplicate plugin node type "${normalizedNode.type}" is not allowed.`,
        code: 'node-duplicate',
      });
      continue;
    }

    seenNodeTypes.add(normalizedNode.type);
    nodes.push(normalizedNode);
  }

  return { nodes, issues };
}

function validatePluginCompatibility(
  manifest: ExternalPluginManifest,
  options: ExternalPluginValidationOptions | undefined,
): ExternalPluginValidationIssue[] {
  const issues: ExternalPluginValidationIssue[] = [];
  const supportedPluginApiVersion =
    options?.supportedPluginApiVersion ?? EXTERNAL_PLUGIN_API_VERSION;
  const currentNodeSdkVersion = options?.currentNodeSdkVersion ?? NODE_SDK_VERSION;

  const pluginApi = normalizeOptionalString(manifest.compat.pluginApi);
  if (!pluginApi?.startsWith('^') && !parseVersion(pluginApi)) {
    issues.push({
      fieldPath: 'openclawWrapper.compat.pluginApi',
      message: `Unsupported pluginApi "${manifest.compat.pluginApi}". Use an exact semver like "${supportedPluginApiVersion}" or a caret range like "^${supportedPluginApiVersion}".`,
      code: 'plugin-api-invalid',
    });
  } else if (!isPluginApiCompatible(pluginApi, supportedPluginApiVersion)) {
    issues.push({
      fieldPath: 'openclawWrapper.compat.pluginApi',
      message: `Plugin targets plugin API "${pluginApi}", but this host supports "${supportedPluginApiVersion}".`,
      code: 'plugin-api-incompatible',
      hint: 'Rebuild the plugin against the current OCW plugin API or update compat.pluginApi to match the supported host version.',
    });
  }

  const minAdapterVersion = normalizeOptionalString(manifest.compat.minAdapterVersion);
  if (minAdapterVersion) {
    const min = parseVersion(minAdapterVersion);
    const current = parseVersion(options?.currentAdapterVersion);
    if (!min) {
      issues.push({
        fieldPath: 'openclawWrapper.compat.minAdapterVersion',
        message: `minAdapterVersion "${minAdapterVersion}" is not a valid semver string.`,
        code: 'adapter-version-invalid',
      });
    } else if (current && compareVersions(current, min) < 0) {
      issues.push({
        fieldPath: 'openclawWrapper.compat.minAdapterVersion',
        message: `Plugin requires adapter version >= ${minAdapterVersion}, but this host is ${options?.currentAdapterVersion}.`,
        code: 'adapter-version-unsupported',
        hint: 'Upgrade the adapter or lower the plugin minimum after confirming compatibility.',
      });
    }
  }

  const nodeSdkVersion = normalizeOptionalString(manifest.compat.nodeSdkVersion);
  if (nodeSdkVersion) {
    const required = parseVersion(nodeSdkVersion);
    const current = parseVersion(currentNodeSdkVersion);
    if (!required) {
      issues.push({
        fieldPath: 'openclawWrapper.compat.nodeSdkVersion',
        message: `nodeSdkVersion "${nodeSdkVersion}" is not a valid semver string.`,
        code: 'node-sdk-version-invalid',
      });
    } else if (current) {
      if (required.major !== current.major || compareVersions(current, required) < 0) {
        issues.push({
          fieldPath: 'openclawWrapper.compat.nodeSdkVersion',
          message: `Plugin expects node-sdk version ${nodeSdkVersion}, but this host provides ${currentNodeSdkVersion}.`,
          code: 'node-sdk-version-unsupported',
          hint: 'Rebuild the plugin against the current workspace node-sdk or upgrade the host package.',
        });
      }
    }
  }

  const reservedNodeTypes = new Set(options?.reservedNodeTypes ?? []);
  for (const [index, node] of manifest.nodes.entries()) {
    if (reservedNodeTypes.has(node.type)) {
      issues.push({
        fieldPath: `openclawWrapper.nodes[${index}].type`,
        message: `Node type "${node.type}" conflicts with a built-in OCW node type.`,
        code: 'node-type-reserved',
        hint: 'Rename the plugin node type so it does not shadow a wrapper-core or OpenClaw-native node.',
      });
    }
  }

  return issues;
}

export function listMissingExternalPluginFieldPaths(packageJson: unknown): string[] {
  const { root, compat, rawNodes } = readPluginBlock(packageJson);
  const missing: string[] = [];

  if (!normalizeOptionalString(root?.name)) {
    missing.push('name');
  }
  if (!normalizeOptionalString(root?.version)) {
    missing.push('version');
  }
  if (!normalizeOptionalString(compat?.pluginApi)) {
    missing.push('openclawWrapper.compat.pluginApi');
  }
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    missing.push('openclawWrapper.nodes');
  }

  return missing;
}

export function normalizeExternalPluginManifest(
  packageJson: unknown,
): ExternalPluginManifest | undefined {
  const { root, compat, rawNodes } = readPluginBlock(packageJson);
  const { nodes, issues } = normalizePluginNodes(rawNodes);
  if (issues.length > 0) {
    return undefined;
  }

  const name = normalizeOptionalString(root?.name);
  const version = normalizeOptionalString(root?.version);
  const pluginApi = normalizeOptionalString(compat?.pluginApi);
  if (!name || !version || !pluginApi) {
    return undefined;
  }

  const manifest: ExternalPluginManifest = {
    name,
    version,
    compat: {
      pluginApi,
      minAdapterVersion: normalizeOptionalString(compat?.minAdapterVersion),
      builtWithAdapterVersion: normalizeOptionalString(compat?.builtWithAdapterVersion),
      nodeSdkVersion: normalizeOptionalString(compat?.nodeSdkVersion),
    },
    nodes,
  };

  const displayName = normalizeOptionalString(root?.displayName);
  if (displayName) {
    manifest.displayName = displayName;
  }

  const description = normalizeOptionalString(root?.description);
  if (description) {
    manifest.description = description;
  }

  return manifest;
}

export function validateExternalPluginPackageJson(
  packageJson: unknown,
  options?: ExternalPluginValidationOptions,
): ExternalPluginValidationResult {
  const missingFieldIssues = listMissingExternalPluginFieldPaths(packageJson).map((fieldPath) => ({
    fieldPath,
    message: `${fieldPath} is required for external OpenClaw Wrapper plugins.`,
    code: 'field-required',
  }));

  const { rawNodes } = readPluginBlock(packageJson);
  const nodeResult = normalizePluginNodes(rawNodes);
  const manifest = normalizeExternalPluginManifest(packageJson);
  const compatibilityIssues = manifest ? validatePluginCompatibility(manifest, options) : [];
  const issues = [...missingFieldIssues, ...nodeResult.issues, ...compatibilityIssues];

  return {
    manifest: issues.length === 0 ? manifest : undefined,
    issues,
  };
}
