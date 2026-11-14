#!/usr/bin/env node
/**
 * Self-check for the dsh-session-namer bundle: manifest, patch, locale metadata,
 * icon bytes, and the runtime module's exported shape. No dependencies.
 *
 *   node scripts/check.mjs
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const ok = (message) => console.log(`  ok  ${message}`)
const fail = (message) => {
  problems.push(message)
  console.log(`  FAIL ${message}`)
}

const readJson = (relative) => {
  const path = join(root, relative)
  if (!existsSync(path)) {
    fail(`${relative} is missing`)
    return undefined
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`)
    return undefined
  }
}

console.log('manifest')
const pkg = readJson('package.json')
if (pkg !== undefined) {
  if (typeof pkg.name !== 'string' || pkg.name === '') fail('package.json name is empty')
  else ok(`name ${pkg.name}`)
  if (pkg.type !== 'module') fail('package.json type must be "module"')
  else ok('type module')
  if (typeof pkg.license !== 'string') fail('package.json license is missing')
  else if (!existsSync(join(root, 'LICENSE'))) fail('LICENSE file is missing')
  else ok(`license ${pkg.license} + LICENSE file`)

  if (pkg.private === true) fail('package.json is private, npm will refuse to publish it')
  else if (pkg.publishConfig?.access !== 'public') fail('publishConfig.access must be "public"')
  else ok('publishable (not private, publishConfig.access = public)')

  if (pkg.name.startsWith('@') && !pkg.name.split('/')[0].slice(1).match(/^[a-z0-9-]+$/)) fail(`scoped name ${pkg.name} is malformed`)
  else ok(`publish name ${pkg.name}`)

  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') fail('dsh.bundle.patch is missing')
  else if (!existsSync(join(root, patch))) fail(`dsh.bundle.patch points at a missing file: ${patch}`)
  else if (!readFileSync(join(root, patch), 'utf8').includes(pkg.name)) fail(`${patch} never mentions ${pkg.name}`)
  else ok(`dsh.bundle.patch -> ${patch} mentions the package`)
}

console.log('locale metadata')
for (const locale of ['en', 'zh']) {
  const file = `locale/${locale}.json`
  const data = readJson(file)
  if (data === undefined) continue
  const title = data.meta?.title
  const description = data.meta?.description
  if (typeof title !== 'string' || title.trim() === '') fail(`${file} meta.title is empty`)
  else if (typeof description !== 'string' || description.trim() === '') fail(`${file} meta.description is empty`)
  else ok(`${file} "${title}"`)
}

console.log('icon')
const iconPath = join(root, 'icon.svg')
if (!existsSync(iconPath)) fail('icon.svg is missing')
else {
  const bytes = statSync(iconPath).size
  const head = readFileSync(iconPath).subarray(0, 5).toString('utf8')
  if (bytes > 256 * 1024) fail(`icon.svg is ${bytes} bytes, the 256 KiB limit is exceeded`)
  else if (!head.startsWith('<svg') && !head.startsWith('<?xml')) fail('icon.svg does not look like SVG')
  else ok(`icon.svg ${bytes} bytes`)
}

console.log('runtime module')
const module = await import(pathToFileURL(join(root, 'index.js')).href)
if (typeof module.apply !== 'function') fail('index.js must export apply(ctx, config)')
else ok('exports apply()')
const injected = Array.isArray(module.inject) ? module.inject : []
for (const service of ['tools', 'systemPrompt']) {
  if (!injected.includes(service)) fail(`inject must include "${service}"`)
}
if (!injected.includes('sessionTitle')) ok('sessionTitle is read optionally, so a missing service cannot block activation')

console.log('prompt guidance')
const guidance = readFileSync(join(root, 'index.js'), 'utf8')
if (!/name: 'session-namer:auto-rename'/.test(guidance)) fail('the prompt section name is missing from index.js')
else ok('prompt section session-namer:auto-rename')
if (!/ctx\.get\('sessionTitle'\)/.test(guidance)) fail('index.js no longer reads ctx.get("sessionTitle")')
else ok('soft dependency on ctx.get("sessionTitle")')

console.log('')
if (problems.length === 0) {
  console.log('PASS — bundle looks installable')
  process.exit(0)
}
console.log(`FAIL — ${problems.length} problem(s)`)
process.exit(1)
