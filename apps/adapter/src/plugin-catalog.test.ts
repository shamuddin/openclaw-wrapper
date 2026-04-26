import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadInstalledPluginCatalog } from './plugin-catalog.js';

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocw-plugin-catalog-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0, tempDirs.length)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe('loadInstalledPluginCatalog', () => {
  it('loads valid external plugin nodes from local package manifests', async () => {
    const pluginsDir = await makeTempDir();
    const pluginDir = path.join(pluginsDir, 'refund-toolkit');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify(
        {
          name: '@demo/refund-toolkit',
          version: '1.0.0',
          displayName: 'Refund Toolkit',
          openclawWrapper: {
            compat: {
              pluginApi: '^1.0.0',
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
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await loadInstalledPluginCatalog({ pluginsDir });

    expect(result.issues).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    expect(result.nodes).toMatchObject([
      {
        type: 'tool.refund-check',
        source: 'external-plugin',
      },
    ]);
  });

  it('reports duplicate external node types across plugins', async () => {
    const pluginsDir = await makeTempDir();

    for (const pluginName of ['plugin-a', 'plugin-b']) {
      const pluginDir = path.join(pluginsDir, pluginName);
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify(
          {
            name: `@demo/${pluginName}`,
            version: '1.0.0',
            openclawWrapper: {
              compat: {
                pluginApi: '^1.0.0',
              },
              nodes: [
                {
                  type: 'tool.shared-node',
                  label: 'Shared Node',
                  category: 'tools',
                  inputs: [],
                  outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
                },
              ],
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    const result = await loadInstalledPluginCatalog({ pluginsDir });

    expect(result.nodes).toHaveLength(1);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Node type "tool.shared-node" is already registered by another external plugin.',
        }),
      ]),
    );
  });

  it('skips invalid plugin manifests and records validation issues', async () => {
    const pluginsDir = await makeTempDir();
    const pluginDir = path.join(pluginsDir, 'broken-plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify(
        {
          name: '@demo/broken-plugin',
          version: '1.0.0',
          openclawWrapper: {
            nodes: [],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await loadInstalledPluginCatalog({ pluginsDir });

    expect(result.plugins).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: 'openclawWrapper.compat.pluginApi',
        }),
      ]),
    );
  });

  it('skips plugins that require a newer adapter version', async () => {
    const pluginsDir = await makeTempDir();
    const pluginDir = path.join(pluginsDir, 'future-plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify(
        {
          name: '@demo/future-plugin',
          version: '1.0.0',
          openclawWrapper: {
            compat: {
              pluginApi: '^1.0.0',
              minAdapterVersion: '9.0.0',
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
        null,
        2,
      ),
      'utf8',
    );

    const result = await loadInstalledPluginCatalog({ pluginsDir });

    expect(result.plugins).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'adapter-version-unsupported',
          fieldPath: 'openclawWrapper.compat.minAdapterVersion',
        }),
      ]),
    );
  });

  it('skips plugins that collide with reserved built-in node types', async () => {
    const pluginsDir = await makeTempDir();
    const pluginDir = path.join(pluginsDir, 'collision-plugin');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify(
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
                label: 'Collision',
                category: 'ai',
                inputs: [],
                outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await loadInstalledPluginCatalog({
      pluginsDir,
      reservedNodeTypes: ['action.agent'],
    });

    expect(result.plugins).toEqual([]);
    expect(result.nodes).toEqual([]);
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
