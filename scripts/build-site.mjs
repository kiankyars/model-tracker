import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist');
execFileSync(process.execPath, ['scripts/build-data.mjs'], { cwd: root, stdio: 'inherit' });

const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = value => escape(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function markdown(source) {
  const blocks = [];
  let paragraph = [], list = [], code = null;
  const flush = () => {
    if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
    if (list.length) blocks.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
    paragraph = []; list = [];
  };
  for (const line of source.split('\n')) {
    if (line.startsWith('```')) {
      flush();
      if (code) { blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); code = null; }
      else code = [];
    } else if (code) code.push(line);
    else if (/^#{1,2} /.test(line)) {
      flush();
      const level = line.startsWith('##') ? 2 : 1;
      blocks.push(`<h${level}>${inline(line.replace(/^#+ /, ''))}</h${level}>`);
    } else if (line.startsWith('- ')) { if (paragraph.length) flush(); list.push(line.slice(2)); }
    else if (!line.trim()) flush();
    else { if (list.length) flush(); paragraph.push(line); }
  }
  flush();
  return blocks.join('\n');
}

for (const [page, title] of [['about', 'About'], ['api', 'Data API']]) {
  const source = await readFile(resolve(root, 'public', `${page}.md`), 'utf8');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f8f7f4" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1c1c19" media="(prefers-color-scheme: dark)">
<title>${title} · Model releases</title><meta name="description" content="${title} for the public language model release catalog.">
<link rel="icon" href="./favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="./docs.css">
<link rel="canonical" href="https://kiankyars.github.io/model-tracker/${page}.html">
<link rel="alternate" type="text/markdown" href="./${page}.md"><link rel="describedby" href="./llms.txt">
</head><body><main class="document"><nav aria-label="Main navigation"><a href="./">← Model releases</a><a href="./about.html">About</a><a href="./api.html">API</a><a href="https://github.com/kiankyars/model-tracker">GitHub ↗</a></nav>
${markdown(source)}
<footer><a href="./">Releases</a> · <a href="./${page}.md">Markdown</a> · <a href="./llms.txt">llms.txt</a></footer></main></body></html>\n`;
  await writeFile(resolve(root, 'public', `${page}.html`), html);
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'public'), out, { recursive: true });
for (const name of ['index.html', 'app.js', 'styles.css', 'favicon.svg', 'lib']) {
  await cp(resolve(root, name), resolve(out, name), { recursive: true, filter: path => !path.endsWith('.test.js') });
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES']) {
  await cp(resolve(root, name), resolve(out, name));
}
// Version the whole module graph so a new page cannot load cached, incompatible code.
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const name of ['index.html', 'about.html', 'api.html']) {
  const path = resolve(out, name);
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/((?:src|href)="\.\/[^"?]+\.(?:css|js))"/g, `$1?v=${encodeURIComponent(version)}"`));
}
for (const name of ['app.js', ...(await readdir(resolve(out, 'lib'))).filter(name => name.endsWith('.js')).map(name => `lib/${name}`)]) {
  const path = resolve(out, name);
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/(from\s+['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, `$1$2?v=${encodeURIComponent(version)}$3`));
}
await writeFile(resolve(out, '.nojekyll'), '');
for (const required of ['index.html', 'api.html', 'about.html', 'llms.txt', 'api/v1/models.json', 'api/v1/index.json']) {
  const info = await stat(resolve(out, required));
  if (!info.isFile() || !info.size) throw new Error(`Missing or empty build output: ${required}`);
}
console.log('Built static site and API in dist/');
