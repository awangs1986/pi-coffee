// @vitest-environment jsdom
// Behavior-level checks for the pure view layer: given data the Host produced,
// render.js must build safe, interactive DOM the way the web shell relies on.
import { describe, expect, it, beforeEach } from 'vitest';
import {
  fileChips, installCopyHandlers, noteNode, renderMarkdown, renderPatchText, userBubble,
} from '../public/render.js';

beforeEach(() => { document.body.innerHTML = ''; });

describe('userBubble', () => {
  it('renders plain text as text (never HTML) and keeps file chips', () => {
    const node = userBubble({ k: 'user', text: '<img src=x onerror=alert(1)>', files: [] });
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('turns files with href into safe download links, files without into plain chips', () => {
    const node = userBubble({
      k: 'user', text: '看这些文件',
      files: [
        { name: 'a.csv', size: 1200, href: 'https://vm.example/download?fileId=x' },
        { name: 'b.bin', size: 5, uploadPath: '.pi-coffee/inbox/s/b.bin' },
      ],
    });
    const [linked, plain] = node.querySelectorAll('.file-chip');
    expect(linked.tagName).toBe('A');
    expect(linked.getAttribute('target')).toBe('_blank');
    expect(linked.getAttribute('rel')).toContain('noopener');
    expect(plain.tagName).toBe('SPAN');
  });
});

describe('renderMarkdown', () => {
  it('sanitizes injected markup and forces safe link attributes', () => {
    const out = renderMarkdown('hi <script>alert(1)</script> [x](https://ok.example)\n\n![p](img.png)');
    const div = document.createElement('div');
    div.innerHTML = out;
    expect(div.querySelector('script')).toBeNull();
    const a = div.querySelector('a[href="https://ok.example"]');
    expect(a)?.toBeDefined();
    expect(a?.getAttribute('rel')).toContain('noopener');
    expect(a?.getAttribute('target')).toBe('_blank');
    // Workspace-relative image stays a data-workspace-path indirection, not a broken src.
    const img = div.querySelector('img');
    expect(img?.getAttribute('data-workspace-path')).toBe('img.png');
  });

  it('renders fenced code with a labelled copy button and language markers', () => {
    const out = renderMarkdown('```js\nconst x = 1\n```');
    const div = document.createElement('div');
    div.innerHTML = out;
    const btn = div.querySelector('[data-copy]');
    expect(btn).not.toBeNull();
    expect(div.querySelector('.codeblock-lang')?.textContent).toBe('js');
  });
});

describe('installCopyHandlers', () => {
  it('copies the codeblock text when its button is clicked', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown('```txt\nhello\n```');
    document.body.append(host);
    installCopyHandlers(host);
    const calls: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => { calls.push(t); return Promise.resolve(); } },
    });
    (host.querySelector('[data-copy]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(calls).toEqual(['hello']);
  });
});

describe('renderPatchText', () => {
  it('escapes patch content and counts additions/deletions', () => {
    const html = renderPatchText('@@ -1,1 +1,2 @@\n-old\n+<b>new</b>\n+second\n');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('b')).toBeNull();
    expect(div.textContent).toContain('<b>new</b>');
    expect(div.querySelector('.diff-stats')?.textContent).toContain('+2');
    expect(div.querySelector('.diff-stats')?.textContent).toContain('−1');
  });
});

describe('noteNode', () => {
  it('escapes note text', () => {
    const node = noteNode({ k: 'note', text: '<iframe src=x></iframe>' });
    expect(node.querySelector('iframe')).toBeNull();
    expect(node.textContent).toContain('<iframe src=x></iframe>');
  });
});
