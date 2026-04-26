import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_PLUGIN_API_VERSION,
  normalizeExternalPluginManifest,
  validateExternalPluginPackageJson,
} from './plugin.js';

describe('validateExternalPluginPackageJson', () => {
  it('normalizes valid plugin nodes as external-plugin sources', () => {
    const result = validateExternalPluginPackageJson({
      name: '@demo/refund-toolkit',
      version: '1.2.3',
      displayName: 'Refund Toolkit',
      description: 'Extra nodes for refund workflows.',
      openclawWrapper: {
        compat: {
          pluginApi: '^1.0.0',
          minAdapterVersion: '0.0.0',
        },
        nodes: [
          {
            type: 'tool.refund-check',
            label: 'Refund Check',
            category: 'tools',
            inputs: [{ name: 'in', label: 'Input', dataType: 'object' }],
            outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
          },
        ],
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.manifest).toMatchObject({
      name: '@demo/refund-toolkit',
      version: '1.2.3',
      displayName: 'Refund Toolkit',
      compat: {
        pluginApi: '^1.0.0',
        minAdapterVersion: '0.0.0',
      },
      nodes: [
        {
          type: 'tool.refund-check',
          source: 'external-plugin',
        },
      ],
    });
  });

  it('reports missing compatibility metadata and invalid node descriptors', () => {
    const result = validateExternalPluginPackageJson({
      name: '@demo/bad-plugin',
      version: '0.1.0',
      openclawWrapper: {
        nodes: [
          {
            type: 'tool.bad-node',
            label: 'Bad Node',
            category: 'tools',
            inputs: [],
            outputs: [{ name: 'out', label: 'Result', dataType: 'uuid' }],
          },
        ],
      },
    });

    expect(result.manifest).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'openclawWrapper.compat.pluginApi',
        }),
        expect.objectContaining({
          fieldPath: expect.stringContaining('openclawWrapper.nodes[0]'),
        }),
      ]),
    );
  });

  it('rejects incompatible plugin host requirements with actionable issues', () => {
    const result = validateExternalPluginPackageJson(
      {
        name: '@demo/future-plugin',
        version: '1.0.0',
        openclawWrapper: {
          compat: {
            pluginApi: '^2.0.0',
            minAdapterVersion: '9.0.0',
            nodeSdkVersion: '2.0.0',
          },
          nodes: [
            {
              type: 'tool.future-check',
              label: 'Future Check',
              category: 'tools',
              inputs: [],
              outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
            },
          ],
        },
      },
      {
        currentAdapterVersion: '0.0.0',
        currentNodeSdkVersion: '0.0.0',
        supportedPluginApiVersion: EXTERNAL_PLUGIN_API_VERSION,
      },
    );

    expect(result.manifest).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'plugin-api-incompatible',
          fieldPath: 'openclawWrapper.compat.pluginApi',
        }),
        expect.objectContaining({
          code: 'adapter-version-unsupported',
          fieldPath: 'openclawWrapper.compat.minAdapterVersion',
        }),
        expect.objectContaining({
          code: 'node-sdk-version-unsupported',
          fieldPath: 'openclawWrapper.compat.nodeSdkVersion',
        }),
      ]),
    );
  });

  it('rejects plugin node types that collide with reserved built-in types', () => {
    const result = validateExternalPluginPackageJson(
      {
        name: '@demo/collision-plugin',
        version: '1.0.0',
        openclawWrapper: {
          compat: {
            pluginApi: '^1.0.0',
          },
          nodes: [
            {
              type: 'action.agent',
              label: 'Colliding Agent',
              category: 'ai',
              inputs: [],
              outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
            },
          ],
        },
      },
      {
        reservedNodeTypes: ['action.agent'],
      },
    );

    expect(result.manifest).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'node-type-reserved',
          fieldPath: 'openclawWrapper.nodes[0].type',
        }),
      ]),
    );
  });
});

describe('normalizeExternalPluginManifest', () => {
  it('rejects duplicate node types inside a plugin manifest', () => {
    const manifest = normalizeExternalPluginManifest({
      name: '@demo/dupe-plugin',
      version: '1.0.0',
      openclawWrapper: {
        compat: {
          pluginApi: '^1.0.0',
        },
        nodes: [
          {
            type: 'tool.refund-check',
            label: 'Refund Check',
            category: 'tools',
            inputs: [],
            outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
          },
          {
            type: 'tool.refund-check',
            label: 'Refund Check Again',
            category: 'tools',
            inputs: [],
            outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
          },
        ],
      },
    });

    expect(manifest).toBeUndefined();
  });
});
