/**
 * dsh-zh-cot-fidelity —— 全局系统提示词插件（1.6.3）。
 *
 * 两层结构：
 *   L1 规则层  中文思维链 + 内容保真 + 反八股 + 工具/检索/代码/长会话/边界，共 15 组，
 *              每组一个开关；文本来源可换（内置 / 文件 / 配置内联 / 指定规则集）。
 *   L2 诊断层  只读审计：挂 system-prompt/assemble，报告分段、运行时策略、工具面、
 *              冲突与执行层归因；不改宿主、不改执行策略。
 *
 * 入口表的设计参考了 dsh-purge 的公开思路（见 README「参考与致谢」）。
 *
 * 入口表（config.entries）决定"规则发到哪里"：
 *   body  order 10150  默认开，与 1.0.0 行为等价
 *   head  order -100000 默认关，开了就排在 HARNESS_IDENTITY(-1000) 之前
 *   post  order 5100    默认关，配置里随手写的补充文本
 *   file  order 10150   默认关，读 $DSH_HOME/zh-cot-fidelity/rules/
 *
 * 文本每次组装系统提示时重新计算（文件带 mtime 缓存），
 * 所以改规则文件下一轮生效 —— 不需要重启。
 *
 * 依赖策略：**零硬依赖**。`@deepseek-ai/schemastery` 只在能解析到时用来提供
 * 配置 schema（插件管理页可见、有类型校验）；解析不到就退化为无 schema 模式 ——
 * cordis 在 `runtime.Config` 缺失时会把行的 config 原样传给 `apply`，
 * 由 config.js 的 normalize() 兜底。因此本插件在任何目录下都能装起来。
 * @module dsh-zh-cot-fidelity
 */
import fs from 'node:fs'
import { FIELDS, normalize, normalizeEntries } from './config.js'
import { SECTION, bumpCache, bundledRulesDir, defaultRuleFile, renderEntries, rulesDir, syncBundledRules } from './entries.js'
import { checkContract } from './contract.js'
import { installAudit } from './audit.js'
import { registerCommands, registerTool } from './commands.js'
import { installUiEndpoints } from './ui.js'

/** Cordis 插件名，同时是提示词 section 的来源标识。 */
export const name = 'dsh-zh-cot-fidelity'

/** 提示词注册表是本插件的硬依赖；没有它的 profile 里这一行保持不激活。 */
export const inject = ['systemPrompt']

/** 版本号（与 package.json 同步）。 */
export const VERSION = '1.6.3'

// 包内出厂档目录与同步逻辑统一在 entries.js（bundledRulesDir / syncBundledRules），这里不再重复定位。

export { SECTION }

/** 可选：解析得到 schemastery 时给出一份 schema，解析不到则为 undefined。 */
let Config
try {
  const { default: z } = await import('@deepseek-ai/schemastery')
  const shape = Object.fromEntries(FIELDS.map(([key, value, description]) => {
    const field = typeof value === 'boolean' ? z.boolean() : typeof value === 'number' ? z.number() : z.string()
    return [key, field.default(value).description(description)]
  }))
  // 入口表是嵌套结构：schema 里只挂一个 any 占位（可见、有说明），
  // 具体形状由 normalizeEntries() 自己校验并报 invalid，避免形状不合法就整行加载失败。
  shape.entries = z.any().description('提示词入口表：{ 入口名: { order, source, enabled, mode, interpolate, text } }')
  Config = z.object(shape)
} catch {
  Config = undefined
}
export { Config }

/**
 * 注册提示词 section（以及可选的诊断、命令、工具）。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 挂载上下文（全局即对所有会话生效）。
 * @param {unknown} rawConfig - 该行的 config。
 */
export function apply(ctx, rawConfig) {
  const { config, unknown, invalid } = normalize(rawConfig)
  const { entries, invalid: entryInvalid } = normalizeEntries(rawConfig)
  const problems = [...invalid, ...entryInvalid]
  if (unknown.length) ctx.logger?.warn?.(`[${name}] 忽略未知配置项：${unknown.join(', ')}`)
  if (problems.length) ctx.logger?.warn?.(`[${name}] 配置问题：${problems.join('；')}`)

  const state = {
    enabled: true,
    assembles: 0,
    last: null,
    contract: null,
    startedAt: Date.now(),
    auditError: '',
    problems,
  }

  // 规则目录：缺就建一个，并把包里的出厂档同步进去。
  // 用户没动过的档跟随插件升级自动更新；改过的保留本地版本（要强制覆盖用 /zhcot sync）。
  try {
    fs.mkdirSync(rulesDir(), { recursive: true })
    const synced = syncBundledRules(bundledRulesDir(), rulesDir())
    if (synced.skipped.length) {
      ctx.logger?.warn?.(`[${name}] 出厂档已有本地修改，未覆盖：${synced.skipped.join('、')}（要覆盖用 /zhcot sync）`)
    }
    // 兜底：包里没带上 active.md 时（异常安装）仍然保住默认文件，否则 file 入口会读空。
    const file = defaultRuleFile()
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, '# 这里放你自己的规则文本\n# 开了 file 入口（或在 config 里指 rulesFile）之后，本文件内容会作为一段系统提示词下发；改完下一轮生效，不需要重启。\n', 'utf8')
    }
  } catch { /* 目录建不出来不影响主流程 */ }

  const plan = renderEntries(config, entries)

  // 微缓存：一次组装里多个 section 复用同一份渲染结果，避免重复读盘与拼装。
  let cachedAt = 0
  let cachedList = []
  const current = (key) => {
    const now = Date.now()
    if (now - cachedAt > 50) {
      cachedList = renderEntries(config, entries)
      cachedAt = now
    }
    const hit = cachedList.find((item) => item.key === key)
    return hit ? hit.text : ''
  }
  const allowed = () => state.enabled && config.enabled !== false

  for (const item of plan) {
    try {
      ctx.effect(
        () => ctx.systemPrompt.section({
          name: item.name,
          order: item.order,
          interpolate: item.interpolate,
          text: () => (allowed() ? current(item.key) : ''),
        }),
        `zh-cot-fidelity.section(${item.key})`,
      )
    } catch (error) {
      // 单个入口注册失败（例如 section 名被别处占用）不该拖垮整行插件。
      ctx.logger?.warn?.(`[${name}] 入口 ${item.key} 注册失败：${error?.message ?? error}`)
    }
  }

  if (config.suppressRuntimeContext) {
    try {
      ctx.effect(
        () => ctx.systemPrompt.suppressRuntimeContext(),
        'zh-cot-fidelity.suppressRuntimeContext()',
      )
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] suppressRuntimeContext 注册失败：${error?.message ?? error}`)
    }
  }

  if (config.contractCheck) {
    state.contract = checkContract(ctx)
    if (!state.contract.ok) {
      const failed = state.contract.checks.filter((item) => !item.ok).map((item) => `${item.label}=${JSON.stringify(item.actual)}`)
      ctx.logger?.warn?.(`[${name}] 契约自检有失败项（dsh 可能升级过）：${failed.join('；')}`)
    }
  }

  if (config.audit) {
    ctx.effect(() => installAudit(ctx, state), 'zh-cot-fidelity.audit()')
  }

  const api = {
    ctx,
    version: VERSION,
    config,
    entries,
    getPlan: () => {
      const now = Date.now()
      if (now - cachedAt > 50) {
        cachedList = renderEntries(config, entries)
        cachedAt = now
      }
      return cachedList
    },
    bump: () => {
      cachedAt = 0
      cachedList = []
      bumpCache()
    },
  }

  // 命令与工具也走 effect：profile 配置改动会热重载并重新 apply，
  // 注册必须能被回收，否则每改一次配置就多叠一份。
  ctx.effect(() => registerCommands(ctx, state, api) ?? (() => {}), 'zh-cot-fidelity.commands()')
  if (config.registerTool) {
    ctx.effect(() => registerTool(ctx, state, api) ?? (() => {}), 'zh-cot-fidelity.tool()')
  }

  // 客户端面板端点（Web GUI 里的入口开关与规则文本编辑）。
  // 内部自己用 ctx.inject 挂 connection，缺失时只告警。
  try {
    installUiEndpoints(ctx, api)
  } catch (error) {
    ctx.logger?.warn?.(`[${name}] UI 端点安装失败：${error?.message ?? error}`)
  }
}
