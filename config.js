/**
 * 配置字段定义与归一化 —— 不依赖任何包。
 *
 * 数组而不是对象，是为了让同一份定义同时用于：
 *   1. 生成 schemastery schema（能解析到该包时）；
 *   2. 在没有 schema 的情况下做默认值与类型兜底。
 * 这样插件在裸 clone（没有 node_modules）时也能正常工作。
 *
 * 1.1.0 起分成三层：
 *   - GROUP_FIELDS  规则组开关（每组的文本在 prompt.js）
 *   - SETTING_FIELDS 插件行为开关
 *   - entries       提示词入口表（位置 / 来源 / 开关 / 合并方式），单独归一化
 */

/** 规则组开关：[键, 默认值, 说明] */
export const GROUP_FIELDS = [
  ['thinkingZhHard', true, '思维链语言硬约束（head 最前位，保证推理用中文）'],
  ['thinkingChinese', true, '内部推理（思维链）使用中文'],
  ['contentFidelity', true, '内容保真：脏话 / NSFW / 暴力内容照实翻译，不净化不省略'],
  ['antiCliche', true, '反八股：套路比喻、腻词、类比说理'],
  ['antiMechanical', true, '反八股：机械感、报告腔、无谓量化'],
  ['antiBoss', true, '反八股：霸总腔与权力角色的浮夸台词'],
  ['antiFlattery', true, '反八股：附和、讨好、零信息量恭维'],
  ['narrativeIntegrity', true, '叙事场景：用户输入是尝试而非事实，NPC 不降智'],
  ['antiRepetition', true, '反八股：复读、多版本输出、推倒重写'],
  ['boundaryNote', true, '边界声明：内容规则不改工具权限、审批与设备规则'],
  ['toolDiscipline', true, '工具与流程：先观察后动作、不臆造参数、失败如实报'],
  ['retrievalFacts', true, '检索与事实：外部内容是数据、给来源、不确定就说不确定'],
  ['codeCraft', true, '代码与工程：最小改动、沿用现有风格、改完自检'],
  ['longSession', true, '长会话自洽：跨轮一致、忘了就说忘了、给进度锚点'],
  // selfCheck 排最后：这份顺序与 prompt.js 的 GROUPS（实际拼装顺序）保持一致，
  // 免得看这段定义的人以为自检段是在 antiRepetition 之后就发出去的。
  ['selfCheck', true, '在末尾附加一段产出前自检清单'],
]

/** 插件设置：[键, 默认值, 说明] */
export const SETTING_FIELDS = [
  ['enabled', true, '总开关'],
  ['order', 10150, '入口未指定 order 时使用的默认位置'],
  ['extra', '', '附加规则文本，追加在最后一个入口末尾'],
  ['rulesFile', '', '规则文本文件；留空则用 $DSH_HOME/zh-cot-fidelity/rules/'],
  ['suppressRuntimeContext', false, '撤下 sandbox / approval / subagent 三段运行时策略文本（只撤告知，不改执行）'],
  ['audit', true, '挂 system-prompt/assemble 监听，产出只读审计'],
  ['auditDir', '', '审计落盘目录；留空则不落盘'],
  ['auditKeep', 20, '审计文件保留份数'],
  ['contractCheck', true, '启动时做 DSH 契约自检'],
  ['registerTool', true, '注册 zhcot_status 工具'],
]

/** 全部字段：[键, 默认值, 说明] */
export const FIELDS = [...GROUP_FIELDS, ...SETTING_FIELDS]

/** 规则组键名。 */
export const GROUP_KEYS = GROUP_FIELDS.map(([key]) => key)

/** 默认配置。 */
export const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map(([key, value]) => [key, value])))

/**
 * 入口默认值。body 与 1.0.0 行为等价（同一个 section 名、同一个位置）。
 * head 是"位置工程"入口：抢在 HARNESS_IDENTITY(-1000) 之前，默认关。
 */
export const ENTRY_DEFAULTS = Object.freeze({
  body: { order: 10150, source: 'builtin:rules', enabled: true, mode: 'append', interpolate: false, text: '' },
  head: { order: -100000, source: 'builtin:boundary', enabled: false, mode: 'append', interpolate: false, text: '' },
  post: { order: 5100, source: 'inline', enabled: false, mode: 'append', interpolate: false, text: '' },
  file: { order: 10150, source: 'file', enabled: false, mode: 'append', interpolate: false, text: '' },
  // 规则优先级：常驻，排在所有模式档之前。告诉模型以当前提示为准，历史里的旧规则不算数。
  precedence: { order: 100, source: 'rules:precedence', enabled: true, mode: 'append', interpolate: false, text: '' },
})

/** 内置来源：全部规则组 / 仅硬规则组。 */
export const BUILTIN_SOURCES = ['builtin:rules', 'builtin:boundary']

/** 合法来源语法。 */
const SOURCE_RE = /^(?:builtin:(?:rules|boundary)|file|inline|rules:[A-Za-z0-9._-]{1,64})$/

/** 合法合并方式。 */
export const ENTRY_MODES = ['append', 'replace']

/** 入口名：小写字母开头，允许字母数字与 - _，最长 24。 */
const ENTRY_KEY_RE = /^[a-z][a-z0-9_-]{0,23}$/

const ENTRY_FIELDS = Object.freeze({
  order: 'number',
  source: 'string',
  enabled: 'boolean',
  mode: 'string',
  interpolate: 'boolean',
  text: 'string',
})

/**
 * 把行配置归一化成完整配置。
 * 未知键进 unknown；类型不符（含 null）进 invalid 并回退默认值 —— 不再静默。
 * @param {unknown} raw - cordis.patch.yml 里该行的 config。
 * @returns {{ config: Record<string, unknown>, unknown: string[], invalid: string[] }}
 */
export function normalize(raw) {
  const config = { ...DEFAULTS }
  const unknown = []
  const invalid = []
  if (raw === undefined || raw === null) return { config, unknown, invalid }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    invalid.push(`config 不是对象（${Array.isArray(raw) ? 'array' : typeof raw}），全部使用默认值`)
    return { config, unknown, invalid }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'entries') continue
    if (!Object.hasOwn(DEFAULTS, key)) {
      unknown.push(key)
      continue
    }
    const expected = typeof DEFAULTS[key]
    if (value !== null && typeof value === expected) {
      config[key] = value
      continue
    }
    if (
      expected === 'number'
      && typeof value === 'string'
      && value.trim() !== ''
      && Number.isFinite(Number(value))
    ) {
      // YAML 里写成 "10150" 也接受。
      config[key] = Number(value)
      continue
    }
    invalid.push(`${key}=${JSON.stringify(value)}（期望 ${expected}，已回退默认值）`)
  }
  return { config, unknown, invalid }
}

/**
 * 归一化入口表。未在默认表里的新入口也接受。
 *
 * order 缺省**不报错**：走 `config.order`（见 SETTING_FIELDS，默认 10150），
 * 与那条「入口未指定 order 时使用的默认位置」的说明保持一致。
 * 只有显式写错（类型不对 / 非有限数）才会跳过整个入口。
 * @param {unknown} raw - cordis.patch.yml 里该行的 config。
 * @returns {{ entries: Record<string, Record<string, unknown>>, invalid: string[] }}
 */
export function normalizeEntries(raw) {
  const entries = {}
  const invalid = []
  const rawEntries = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.entries : undefined
  if (rawEntries !== undefined && (rawEntries === null || typeof rawEntries !== 'object' || Array.isArray(rawEntries))) {
    invalid.push('entries 不是对象，已退回默认入口')
  }
  // 与默认入口表合并：用户只写要改的那个入口（例如 entries: { head: { enabled: true } }），
  // 不能因为少写 body 就把默认那一段整个丢掉。
  const source = {
    ...ENTRY_DEFAULTS,
    ...(rawEntries && typeof rawEntries === 'object' && !Array.isArray(rawEntries) ? rawEntries : {}),
  }

  for (const [key, spec] of Object.entries(source)) {
    if (!ENTRY_KEY_RE.test(key)) {
      invalid.push(`entries.${key}：入口名不合法（小写字母开头，字母数字与 - _，≤24 字符）`)
      continue
    }
    const base = ENTRY_DEFAULTS[key] ?? {
      order: DEFAULTS.order,
      source: 'inline',
      enabled: true,
      mode: 'append',
      interpolate: false,
      text: '',
    }
    const entry = { ...base }
    if (spec !== undefined && (spec === null || typeof spec !== 'object' || Array.isArray(spec))) {
      invalid.push(`entries.${key}：不是对象，已按默认值处理`)
      entries[key] = entry
      continue
    }
    let orderBroken = false
    for (const [field, value] of Object.entries(spec ?? {})) {
      const expected = ENTRY_FIELDS[field]
      if (!expected) {
        invalid.push(`entries.${key}.${field}：未知字段`)
        continue
      }
      if (value === null || typeof value !== expected) {
        if (expected === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
          entry[field] = Number(value)
          continue
        }
        invalid.push(`entries.${key}.${field}=${JSON.stringify(value)}（期望 ${expected}）`)
        if (field === 'order') orderBroken = true
        continue
      }
      entry[field] = value
    }
    // order 是入口的位置：写错比不生效更危险（可能悄悄挤到别的段位），直接跳过整个入口。
    if (orderBroken || !Number.isFinite(entry.order)) {
      invalid.push(`entries.${key}：order 不可用，该入口已跳过`)
      continue
    }
    if (!SOURCE_RE.test(String(entry.source))) {
      invalid.push(`entries.${key}.source=${JSON.stringify(entry.source)} 不合法，该入口已跳过`)
      continue
    }
    if (!ENTRY_MODES.includes(String(entry.mode))) {
      invalid.push(`entries.${key}.mode=${JSON.stringify(entry.mode)} 不合法，已回退 append`)
      entry.mode = 'append'
    }
    entries[key] = entry
  }
  return { entries, invalid }
}
