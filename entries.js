/**
 * 入口解析 —— 把配置里的 entries 变成一段段可注册的提示词文本。
 *
 * 一个入口 = 位置(order) + 来源(source) + 开关(enabled) + 合并方式(mode)。
 * 来源四种：
 *   builtin:rules     全部规则组（按开关拼装）
 *   builtin:boundary  仅硬规则组（边界声明 + 工具与流程），适合放 head 抢位
 *   file              $DSH_HOME/zh-cot-fidelity/rules/ 下的规则文本
 *   inline            entry.text 里直接写
 *   rules:<id>        指定某一个规则文件
 *
 * 文本每次组装系统提示时重新计算（文件读取带 mtime 缓存），
 * 所以改规则文件下一轮就生效，不需要重启 DSH。
 *
 * 入口表、可编辑规则文件与位置工程这几处设计参考了 dsh-purge 的公开思路
 * （prompt-inject.md / postPrompt+postPromptOrder / GLOBAL_PROMPT_ORDER）；
 * 见 README「参考与致谢」。代码为本项目独立编写。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ENTRY_DEFAULTS } from './config.js'
import { HEADER, GROUPS, BOUNDARY_KEYS } from './prompt.js'

/** 可选依赖：解析得到就用官方 home 解析，解析不到退回 DSH_HOME / ~/.dsh。 */
let dshHomePath
try {
  ({ dshHomePath } = await import('@deepseek-ai/dsh-home-paths'))
} catch {
  dshHomePath = undefined
}

/** 运行时目录名。 */
export const RUNTIME_DIR = 'zh-cot-fidelity'
/** section 名：body 沿用 1.0.0 的稳定名，避免任何外部引用失效。 */
export const SECTION = 'dsh:zh-cot-fidelity'

/**
 * 解析 $DSH_HOME。
 * @returns {string} 主目录绝对路径。
 */
export function resolveHome() {
  try {
    if (typeof dshHomePath === 'function') {
      const hit = dshHomePath()
      if (hit) return String(hit)
    }
  } catch { /* 落到下面的兜底 */ }
  const env = String(process.env.DSH_HOME || '').trim()
  if (env) return env
  return path.join(os.homedir(), '.dsh')
}

/** @returns {string} 插件运行时目录。 */
export function pluginDir() {
  return path.join(resolveHome(), RUNTIME_DIR)
}

/** @returns {string} 规则目录。 */
export function rulesDir() {
  return path.join(pluginDir(), 'rules')
}

/** @returns {string} 默认规则文件。 */
export function defaultRuleFile() {
  return path.join(rulesDir(), 'active.md')
}

/** @returns {string} 审计目录。 */
export function auditDir() {
  return path.join(pluginDir(), 'audit')
}

/** @returns {string} 规则切换指针。 */
function activeStateFile() {
  return path.join(rulesDir(), 'active.json')
}

/** 文件内容缓存（按 mtime + size 判定）。 */
const fileCache = new Map()
/** 缓存世代：/zhcot reload 会把它 +1，强制下次重读。 */
let epoch = 0

/** 清空文件缓存。 */
export function bumpCache() {
  epoch += 1
  fileCache.clear()
}

/**
 * 读文本文件，带 mtime 缓存；读不到返回 null。
 * @param {string} file - 绝对路径。
 * @returns {string|null} 文件内容。
 */
export function readText(file) {
  try {
    const stat = fs.statSync(file)
    const hit = fileCache.get(file)
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size && hit.epoch === epoch) return hit.text
    const text = fs.readFileSync(file, 'utf8')
    fileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, epoch, text })
    return text
  } catch {
    return null
  }
}

/** 当前生效的规则文件（active.json → rules/<id>.md，否则 active.md）。 */
export function activeRuleFile(config) {
  const explicit = String(config?.rulesFile || '').trim()
  if (explicit) return explicit
  const state = readText(activeStateFile())
  if (state) {
    try {
      const id = String(JSON.parse(state)?.active || '').trim()
      if (/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
        const file = path.join(rulesDir(), `${id}.md`)
        if (fs.existsSync(file)) return file
      }
    } catch { /* 指针坏了就退回 active.md */ }
  }
  return defaultRuleFile()
}

/** 列出可用规则集。 */
export function listRules() {
  const out = []
  try {
    for (const name of fs.readdirSync(rulesDir())) {
      if (!name.endsWith('.md')) continue
      const file = path.join(rulesDir(), name)
      const text = readText(file) || ''
      out.push({ id: name.slice(0, -3), file, chars: text.length })
    }
  } catch { /* 目录不存在 */ }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/**
 * 切换规则集（原子写指针）。
 * @param {string} id - 规则集 id。
 * @returns {string} 指向的文件路径。
 */
export function useRule(id) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) throw new Error(`规则集 id 不合法：${id}`)
  const file = path.join(rulesDir(), `${id}.md`)
  if (!fs.existsSync(file)) throw new Error(`规则集不存在：${file}`)
  fs.mkdirSync(rulesDir(), { recursive: true })
  const target = activeStateFile()
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ active: id }, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, target)
  bumpCache()
  return file
}

/** 拼装内置规则组。 */
function renderBuiltin(config, kind, used) {
  const keys = kind === 'boundary' ? BOUNDARY_KEYS : null
  const parts = []
  for (const [key, text] of GROUPS) {
    if (keys && !keys.includes(key)) continue
    if (!config[key]) continue
    if (used.has(key)) continue
    used.add(key)
    parts.push(text)
  }
  return parts.join('\n\n')
}

/** 渲染单个入口的来源文本。 */
function renderSource(config, spec, used) {
  const source = String(spec.source)
  if (source === 'builtin:rules') return renderBuiltin(config, 'rules', used)
  if (source === 'builtin:boundary') return renderBuiltin(config, 'boundary', used)
  if (source === 'file') {
    const file = activeRuleFile(config)
    return String(readText(file) || '').trim()
  }
  if (source.startsWith('rules:')) {
    const id = source.slice('rules:'.length)
    const file = path.join(rulesDir(), `${id}.md`)
    return String(readText(file) || '').trim()
  }
  return String(spec.text || '').trim()
}

/**
 * 计算本次组装要用的入口列表。
 * mode=replace 的入口内容非空时，只保留 replace 入口；否则按 order 升序拼接 append 入口。
 * @param {Record<string, unknown>} config - 归一化后的配置。
 * @param {Record<string, Record<string, unknown>>} entries - 归一化后的入口表。
 * @returns {Array<{key:string,name:string,order:number,interpolate:boolean,source:string,enabled:boolean,text:string}>}
 */
export function renderEntries(config, entries) {
  const used = new Set()
  const list = Object.entries(entries ?? ENTRY_DEFAULTS)
    .sort((a, b) => (a[1].order - b[1].order) || a[0].localeCompare(b[0]))
    .map(([key, spec]) => {
      const enabled = spec.enabled !== false
      return {
        key,
        name: key === 'body' ? SECTION : `${SECTION}:${key}`,
        order: spec.order,
        interpolate: spec.interpolate === true,
        source: String(spec.source),
        enabled,
        // 关掉的入口不渲染：否则它会先占用 used，把属于它的规则组从后面真正启用的入口里挤掉。
        text: enabled ? renderSource(config, spec, used) : '',
      }
    })

  // replace：内容非空的 replace 入口独占输出，其余入口全部让位。
  const replacers = list.filter((item) => entries[item.key].mode === 'replace' && item.text)
  const picked = replacers.length ? replacers : list.filter((item) => item.enabled && item.text)
  if (!picked.length) return []

  // 头部标题只出现一次，且只挂在内置规则组入口上。
  // HEADER 写的是「中文思维链 / 内容保真 / 反八股」——那是 builtin:rules 的内容；
  // 按「第一个入口」来挂会落到 head（builtin:boundary，边界声明 + 工具与流程）头上，
  // 标题与紧随其后的正文对不上。
  const headerKey = picked.find((item) => item.source === 'builtin:rules')?.key
  // extra 只追加到最后一个入口。
  return picked.map((item, index) => {
    const last = index === picked.length - 1
    const parts = []
    if (item.key === headerKey) parts.push(HEADER)
    parts.push(item.text)
    if (last && config.extra) parts.push(String(config.extra))
    return { ...item, text: parts.join('\n\n') }
  })
}
