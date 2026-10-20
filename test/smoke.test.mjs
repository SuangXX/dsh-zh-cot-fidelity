/**
 * 发布前冒烟测试：不连宿主、不碰运行时目录，只校验包本身自洽。
 *
 * 跑法：npm test（= node --test test/）。
 * GitHub Actions 的 publish workflow 在 npm publish 之前会先跑这一份。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))

const pkg = readJson('package.json')
const { VERSION } = await import('../index.js')
const { GROUPS, THINKING_ZH, THINKING_ZH_HARD, BOUNDARY_KEYS } = await import('../prompt.js')
const { GROUP_KEYS, ENTRY_DEFAULTS, normalize } = await import('../config.js')

test('版本号与 package.json 一致', () => {
  assert.equal(VERSION, pkg.version, `index.js VERSION=${VERSION}，package.json version=${pkg.version}`)
})

test('规则组与配置开关一一对应、顺序一致且文本非空', () => {
  assert.equal(GROUPS.length, 15)
  assert.deepEqual(GROUPS.map(([key]) => key), [...GROUP_KEYS])
  for (const [key, text] of GROUPS) {
    assert.equal(typeof text, 'string')
    assert.ok(text.trim().length > 0, `${key} 的规则文本为空`)
  }
})

test('思维链语言硬约束在 head 硬规则组里', () => {
  assert.ok(THINKING_ZH_HARD.includes('一律用中文书写'))
  assert.ok(BOUNDARY_KEYS.includes('thinkingZhHard'))
  assert.ok(!THINKING_ZH.includes('一律用中文书写'), 'body 里不该再重复一遍思维链语言条款')
})

test('思维链完整句约束在核心规则组里', () => {
  assert.ok(THINKING_ZH.includes('思维链用完整句子写'))
  assert.ok(THINKING_ZH.includes('单字充数'))
})

test('硬规则组取思维链硬约束、边界声明与工具纪律', () => {
  assert.deepEqual([...BOUNDARY_KEYS], ['thinkingZhHard', 'boundaryNote', 'toolDiscipline'])
})

test('入口默认值包含 body 与 precedence', () => {
  assert.ok(ENTRY_DEFAULTS.body, '缺 body 入口默认值')
  assert.ok(ENTRY_DEFAULTS.precedence, '缺 precedence 入口默认值')
  assert.equal(ENTRY_DEFAULTS.body.source, 'builtin:rules')
  assert.equal(ENTRY_DEFAULTS.precedence.source, 'rules:precedence')
})

test('配置类型不符时回退默认值并记录', () => {
  const { config, invalid } = normalize({ thinkingChinese: 'yes' })
  assert.equal(config.thinkingChinese, true)
  assert.ok(invalid.some((line) => line.includes('thinkingChinese')), '类型错误没有被记录')
})

test('出厂规则档齐全', () => {
  const want = [
    'active.md',
    'precedence.md',
    'scene-work.md',
    'scene-chat.md',
    'style-intimate.md',
    'style-violence.md',
    'style-nsfw.md',
    'universal.md',
    'universal-plus.md',
  ]
  for (const name of want) {
    assert.ok(fs.existsSync(path.join(root, 'rules', name)), `缺规则档 rules/${name}`)
  }
})

test('package.json files 白名单里的文件都存在', () => {
  for (const entry of pkg.files) {
    if (entry.includes('*')) continue
    assert.ok(fs.existsSync(path.join(root, entry)), `files 里列了不存在的文件：${entry}`)
  }
  assert.ok(fs.existsSync(path.join(root, 'locale')), '缺 locale 目录')
})
