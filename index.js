/**
 * dsh-zh-cot-fidelity —— 全局系统提示词插件。
 *
 * 在 profile 根作用域注册一个 `dsh:zh-cot-fidelity` 提示词 section，
 * 因此对所有会话、所有 agent preset、所有子 agent 生效。
 *
 * 三组规则：
 *   1. 中文思维链：内部推理用中文；
 *   2. 内容保真：原文的脏话 / NSFW / 血腥暴力照实翻译，不净化不省略；
 *   3. 反八股：套路比喻、机械报告腔、霸总腔、讨好附和、复读与多版本输出。
 *
 * 每一组都能在 cordis.patch.yml 的 config 里单独关掉。
 *
 * 依赖策略：**零硬依赖**。`@deepseek-ai/schemastery` 只在能解析到时用来提供
 * 配置 schema（插件管理页可见、有类型校验）；解析不到（例如裸 clone 到普通目录、
 * 没有 node_modules）就退化为无 schema 模式 —— cordis 在 `runtime.Config` 缺失时
 * 会把行的 config 原样传给 `apply`（见 cordis/lib/index.js 的 resolveConfig），
 * 由 config.js 的 normalize() 兜底。因此本插件在任何目录下都能装起来。
 * @module dsh-zh-cot-fidelity
 */
import { FIELDS, normalize } from './config.js'
import {
  HEADER,
  THINKING_ZH,
  FIDELITY,
  ANTI_CLICHE,
  ANTI_MECHANICAL,
  ANTI_BOSS,
  ANTI_FLATTERY,
  NARRATIVE,
  ANTI_REPETITION,
  SELF_CHECK,
} from './prompt.js'

/** Cordis 插件名，同时是提示词 section 的来源标识。 */
export const name = 'dsh-zh-cot-fidelity'

/** 提示词注册表是本插件的硬依赖；没有它的 profile 里这一行保持不激活。 */
export const inject = ['systemPrompt']

/** 提示词 section 的稳定名称。 */
export const SECTION = 'dsh:zh-cot-fidelity'

/** 可选：解析得到 schemastery 时给出一份 schema，解析不到则为 undefined。 */
let Config
try {
  const { default: z } = await import('@deepseek-ai/schemastery')
  Config = z.object(Object.fromEntries(FIELDS.map(([key, value, description]) => {
    const field = typeof value === 'boolean' ? z.boolean() : typeof value === 'number' ? z.number() : z.string()
    return [key, field.default(value).description(description)]
  })))
} catch {
  Config = undefined
}
export { Config }

/**
 * 按配置拼出完整提示词。
 * @param {Record<string, unknown>} config - 归一化后的配置。
 * @returns {string} 系统提示词文本。
 */
export function compose(config) {
  const parts = [HEADER]
  if (config.thinkingChinese) parts.push(THINKING_ZH)
  if (config.contentFidelity) parts.push(FIDELITY)
  if (config.antiCliche) parts.push(ANTI_CLICHE)
  if (config.antiMechanical) parts.push(ANTI_MECHANICAL)
  if (config.antiBoss) parts.push(ANTI_BOSS)
  if (config.antiFlattery) parts.push(ANTI_FLATTERY)
  if (config.narrativeIntegrity) parts.push(NARRATIVE)
  if (config.antiRepetition) parts.push(ANTI_REPETITION)
  if (config.selfCheck) parts.push(SELF_CHECK)
  if (config.extra) parts.push(String(config.extra))
  return parts.join('\n\n')
}

/**
 * 注册提示词 section。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 挂载上下文（全局即对所有会话生效）。
 * @param {unknown} rawConfig - 该行的 config。
 */
export function apply(ctx, rawConfig) {
  const { config, unknown } = normalize(rawConfig)
  if (unknown.length) {
    ctx.logger?.warn?.(`[${name}] 忽略未知配置项：${unknown.join(', ')}`)
  }
  const text = compose(config)
  if (text === HEADER) return
  ctx.effect(
    () => ctx.systemPrompt.section({ name: SECTION, order: config.order, text }),
    'zh-cot-fidelity.section()',
  )
}
