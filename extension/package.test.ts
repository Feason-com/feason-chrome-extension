import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('ships a self-contained extension with every imported module, image, font, and font license', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const scratch = mkdtempSync(join(tmpdir(), 'feason-extension-package-test-'));
  try {
    const archive = join(scratch, 'extension.zip');
    const unpacked = join(scratch, 'unpacked');
    execFileSync(process.execPath, ['scripts/package-chrome-extension.mts', archive], { cwd: root });
    execFileSync('unzip', ['-q', archive, '-d', unpacked]);
    const manifest = JSON.parse(readFileSync(join(unpacked, 'manifest.json'), 'utf8'));
    const sourceManifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'));
    expect(manifest.key).toBe(sourceManifest.key);
    expect(manifest.permissions).toEqual(['activeTab', 'contextMenus', 'identity', 'sidePanel', 'storage']);
    expect(manifest.content_scripts).toBeUndefined();
    expect(JSON.parse(readFileSync(join(unpacked, 'books.json'), 'utf8')).find((book: { number: number }) => book.number === 43).slug).toBe('john');
    const queue: string[] = [manifest.background.service_worker, manifest.action.default_popup, manifest.side_panel.default_path.split('?')[0], 'books.json', 'print.html', ...Object.values<string>(manifest.icons)];
    const visited = new Set<string>();
    while (queue.length) {
      const asset = queue.shift()!;
      if (visited.has(asset)) continue;
      visited.add(asset);
      const file = join(unpacked, asset);
      expect(existsSync(file), `Missing runtime asset: ${asset}`).toBe(true);
      if (!/\.(mjs|html|css)$/.test(file)) continue;
      const content = readFileSync(file, 'utf8');
      const patterns = [/\bfrom\s+['"](.+?)['"]/g, /\b(?:src|href)="(.+?)"/g, /\burl\(["']?([^"')]+)["']?\)/g];
      for (const pattern of patterns) for (const match of content.matchAll(pattern)) {
        if (match[1].startsWith('http')) throw new Error(`Remote runtime asset: ${match[1]}`);
        queue.push(join(dirname(asset), match[1]));
      }
    }
    expect(visited.size).toBeGreaterThan(12);
    for (const font of ['cormorant-garamond', 'dm-sans', 'eb-garamond']) {
      expect(existsSync(join(unpacked, 'fonts', `${font}-LICENSE.txt`))).toBe(true);
    }
    const files = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    expect(files).not.toMatch(/test\.|STORE_LISTING|node_modules|\.env/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
