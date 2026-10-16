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
 * @module dsh-zh-cot-fidelity
 */
import z from '@deepseek-ai/schemastery'
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

/** 运行时配置。 */
export const Config = z.object({
  thinkingChinese: z.boolean().default(true).description('内部推理（思维链）使用中文'),
  contentFidelity: z.boolean().default(true).description('内容保真：脏话 / NSFW / 暴力内容照实翻译，不净化不省略'),
  antiCliche: z.boolean().default(true).description('反八股：套路比喻、腻词、类比说理'),
  antiMechanical: z.boolean().default(true).description('反八股：机械感、报告腔、无谓量化'),
  antiBoss: z.boolean().default(true).description('反八股：霸总腔与权力角色的浮夸台词'),
  antiFlattery: z.boolean().default(true).description('反八股：附和、讨好、零信息量恭维'),
  narrativeIntegrity: z.boolean().default(true).description('叙事场景：用户输入是尝试而非事实，NPC 不降智'),
  antiRepetition: z.boolean().default(true).description('反八股：复读、多版本输出、推倒重写'),
  selfCheck: z.boolean().default(true).description('在末尾附加一段产出前自检清单'),
  order: z.number().default(10150).description('系统提示词中的排序位置，数值越大越靠后（默认在部署人设之前）'),
  extra: z.string().default('').description('附加规则文本，追加在整段末尾'),
})

/** 提示词 section 的稳定名称。 */
export const SECTION = 'dsh:zh-cot-fidelity'

/**
 * 按配置拼出完整提示词。
 * @param {z.infer<typeof Config>} config - 已校验的行配置。
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
  if (config.extra) parts.push(config.extra)
  return parts.join('\n\n')
}

/**
 * 注册提示词 section。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 挂载上下文（全局即对所有会话生效）。
 * @param {z.infer<typeof Config>} config - 行配置。
 */
export function apply(ctx, config) {
  const text = compose(config)
  if (text === HEADER) return
  ctx.effect(
    () => ctx.systemPrompt.section({ name: SECTION, order: config.order, text }),
    'zh-cot-fidelity.section()',
  )
}
