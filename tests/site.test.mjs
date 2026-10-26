import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

test('published pages and agent documentation link to existing project-relative resources', async () => {
  for (const page of ['index.html', 'api.html', 'about.html', 'llms.txt', 'index.md', 'api.md', 'about.md']) {
    const source = await readFile(resolve(dist, page), 'utf8');
    const links = [...source.matchAll(/(?:href|src)="([^"]+)"|\]\(([^)]+)\)/g)].map(match => match[1] || match[2]);
    for (let link of links) {
      if (link.startsWith('https://kiankyars.github.io/model-tracker/')) link = `./${link.slice('https://kiankyars.github.io/model-tracker/'.length)}`;
      if (/^(https?:|#|data:)/.test(link)) continue;
      assert.ok(!link.startsWith('/'), `Origin-root link would break GitHub project pages: ${page} → ${link}`);
      const target = resolve(dirname(resolve(dist, page)), link.split(/[?#]/)[0]);
      assert.ok((await stat(target)).isFile() || (await stat(target)).isDirectory(), `${page} → ${link}`);
    }
  }
});

test('all model records satisfy the published schema field types, required fields and bounds', async () => {
  const schema = JSON.parse(await readFile(resolve(dist, 'api-schema.json'), 'utf8'));
  const catalog = JSON.parse(await readFile(resolve(dist, 'api/v1/models.json'), 'utf8'));
  function check(value, rule, path) {
    if (rule.enum) assert.ok(rule.enum.includes(value), `Unexpected enum at ${path}`);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (rule.type) assert.ok([rule.type].flat().includes(actual), `Expected ${rule.type}, got ${actual} at ${path}`);
    if (actual === 'object') {
      for (const field of rule.required || []) assert.ok(Object.hasOwn(value, field), `Missing ${path}.${field}`);
      for (const [field, child] of Object.entries(rule.properties || {})) if (Object.hasOwn(value, field)) check(value[field], child, `${path}.${field}`);
    }
    if (actual === 'array') {
      if (rule.minItems) assert.ok(value.length >= rule.minItems, `Empty ${path}`);
      for (const item of value) if (rule.items) check(item, rule.items, `${path}[]`);
    }
    if (actual === 'string' && rule.pattern) assert.match(value, new RegExp(rule.pattern), path);
    if (actual === 'number' && rule.exclusiveMinimum !== undefined) assert.ok(value > rule.exclusiveMinimum, path);
  }
  for (const model of catalog.models) check(model, schema, model.id);
  const api = JSON.parse(await readFile(resolve(dist, 'openapi.json'), 'utf8'));
  assert.equal(api.openapi, '3.1.0');
  assert.equal(new Set(Object.values(api.paths).map(path => path.get.operationId)).size, Object.keys(api.paths).length);
});
