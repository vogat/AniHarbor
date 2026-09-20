import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'acorn';

test('Every first-party TV script parses as ES5 for the 2016 Samsung engine', async () => {
  const scripts = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'vendor') continue;
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await scan(file);
      else if (entry.name.endsWith('.js')) scripts.push(file);
    }
  }
  await scan(new URL('../tv/', import.meta.url));
  assert.ok(scripts.length, 'The TV app must contain a script');
  for (const script of scripts) {
    const source = await readFile(script, 'utf8');
    assert.doesNotThrow(() => parse(source, { ecmaVersion: 5 }), script.pathname);
  }
});
test('Tizen manifest requires 2.4 and includes needed input/network permissions', async () => {
  const xml = await readFile(new URL('../tv/config.xml', import.meta.url), 'utf8');
  assert.match(xml, /required_version="2\.4"/);
  assert.match(xml, /privilege\/internet/); assert.match(xml, /privilege\/tv.inputdevice/);
});
