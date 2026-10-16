/**
 * 配置字段定义与归一化 —— 不依赖任何包。
 *
 * 数组而不是对象，是为了让同一份定义同时用于：
 *   1. 生成 schemastery schema（能解析到该包时）；
 *   2. 在没有 schema 的情况下做默认值与类型兜底。
 * 这样插件在裸 clone（没有 node_modules）时也能正常工作。
 */

/** [键, 默认值, 说明] */
export const FIELDS = [
  ['thinkingChinese', true, '内部推理（思维链）使用中文'],
  ['contentFidelity', true, '内容保真：脏话 / NSFW / 暴力内容照实翻译，不净化不省略'],
  ['antiCliche', true, '反八股：套路比喻、腻词、类比说理'],
  ['antiMechanical', true, '反八股：机械感、报告腔、无谓量化'],
  ['antiBoss', true, '反八股：霸总腔与权力角色的浮夸台词'],
  ['antiFlattery', true, '反八股：附和、讨好、零信息量恭维'],
  ['narrativeIntegrity', true, '叙事场景：用户输入是尝试而非事实，NPC 不降智'],
  ['antiRepetition', true, '反八股：复读、多版本输出、推倒重写'],
  ['selfCheck', true, '在末尾附加一段产出前自检清单'],
  ['order', 10150, '系统提示词中的排序位置，数值越大越靠后'],
  ['extra', '', '附加规则文本，追加在整段末尾'],
]

/** 默认配置。 */
export const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map(([key, value]) => [key, value])))

/**
 * 把行配置归一化成完整配置：未知键忽略、类型不符的键回退默认值。
 * @param {unknown} raw - cordis.patch.yml 里该行的 config。
 * @returns {{ config: Record<string, unknown>, unknown: string[] }}
 */
export function normalize(raw) {
  const config = { ...DEFAULTS }
  const unknown = []
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(DEFAULTS, key)) {
        unknown.push(key)
        continue
      }
      const expected = typeof DEFAULTS[key]
      if (typeof value === expected) {
        config[key] = value
      } else if (
        expected === 'number'
        && typeof value === 'string'
        && value.trim() !== ''
        && Number.isFinite(Number(value))
      ) {
        // YAML 里写成 "10150" 也接受。
        config[key] = Number(value)
      }
    }
  }
  return { config, unknown }
}
