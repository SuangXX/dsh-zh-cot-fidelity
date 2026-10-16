/**
 * 命令面与工具面。
 *
 *   /zhcot status          一行摘要（是否生效、入口、来源、字符数、契约自检）
 *   /zhcot audit [--json]  分层审计（只读）；--json 时落盘
 *   /zhcot list            列出可用规则集
 *   /zhcot use <id>        切换规则集（写指针，下一轮生效）
 *   /zhcot reload          清文件缓存，立即重读
 *   /zhcot off | on        临时停用 / 恢复（运行时状态，重启回到配置值）
 *
 * 另外注册 zhcot_status 工具，让 agent 自己能查当前注入状态。
 */
import { activeRuleFile, listRules, pluginDir, resolveHome, useRule } from './entries.js'
import { buildReport, writeAudit } from './audit.js'
import { contractSummary } from './contract.js'

/** 命令帮助文本。 */
const HELP = [
  '/zhcot status          当前状态摘要',
  '/zhcot audit [--json]  分层审计（--json 落盘到 auditDir）',
  '/zhcot list            列出规则集',
  '/zhcot use <id>        切换规则集',
  '/zhcot reload          清缓存重读规则文件',
  '/zhcot off | on        临时停用 / 恢复',
].join('\n')

/** 状态摘要。 */
function statusText(api, state) {
  const plan = api.getPlan()
  const lines = [`dsh-zh-cot-fidelity ${api.version}`]
  lines.push(`状态：${state.enabled ? '开' : '临时停用（/zhcot on 恢复）'}${api.config.enabled ? '' : '；配置里 enabled=false'}`)
  lines.push(`契约自检：${contractSummary(state.contract)}`)
  if (!plan.length) lines.push('入口：全部关闭或内容为空 —— 当前没有注册任何 section')
  for (const item of plan) {
    const label = item.key === 'body' ? '（默认）' : ''
    lines.push(`入口 ${item.key}${label}：order ${item.order}｜${item.source}｜${item.interpolate ? '插值开' : '插值关'}｜${item.text.length} 字符｜${item.name}`)
  }
  lines.push(`规则文件：${activeRuleFile(api.config)}`)
  lines.push(`DSH_HOME：${resolveHome()}｜运行时目录：${pluginDir()}`)
  if (state.last) {
    const ours = state.last.sections.filter((item) => item.name.startsWith('dsh:zh-cot-fidelity'))
    const chars = ours.reduce((sum, item) => sum + item.chars, 0)
    const share = state.last.totalChars ? ((chars / state.last.totalChars) * 100).toFixed(1) : '0.0'
    lines.push(`最近组装：共 ${state.assembles} 次；section ${state.last.sections.length} 段 / ${state.last.totalChars} 字符，本插件占 ${share}%`)
  } else if (api.config.audit) {
    lines.push('最近组装：尚未捕获（重启后开一轮对话即可）')
  }
  if (state.auditError) lines.push(`审计监听异常：${state.auditError}`)
  return lines.join('\n')
}

/** 处理一条 /zhcot 输入。 */
function handle(raw, api, state) {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] || 'status').toLowerCase()
  const rest = parts.slice(1)

  if (sub === 'help') return { kind: 'success', text: HELP }

  if (sub === 'status') return { kind: 'success', text: statusText(api, state) }

  if (sub === 'audit') {
    const text = buildReport(api.ctx, state, api.config, api.getPlan())
    if (rest.includes('--json')) {
      const file = writeAudit({ ...api.config, auditDir: api.config.auditDir || pluginDir() + '/audit' }, state)
      return { kind: 'success', text: file ? `${text}\n\n已落盘：${file}` : `${text}\n\n（落盘失败或没有快照）` }
    }
    return { kind: 'success', text }
  }

  if (sub === 'list') {
    const items = listRules()
    const current = activeRuleFile(api.config)
    if (!items.length) return { kind: 'success', text: `规则目录为空：${pluginDir()}/rules/\n放一个 <id>.md 进去再用 /zhcot use <id> 切换。` }
    return {
      kind: 'success',
      text: items.map((item) => `${item.id === current.replace(/\.md$/, '') ? '←' : ' '} ${item.id}（${item.chars} 字符）`).join('\n') + `\n\n当前生效：${current}`,
    }
  }

  if (sub === 'use') {
    const id = rest[0]
    if (!id) return { kind: 'error', text: `用法：/zhcot use <id>\n可用：${listRules().map((item) => item.id).join('、') || '（无）'}` }
    try {
      const file = useRule(id)
      api.bump()
      return { kind: 'success', text: `已切到规则集 ${id}：${file}\n下一轮组装生效（不需要重启）。` }
    } catch (error) {
      return { kind: 'error', text: String(error?.message ?? error) }
    }
  }

  if (sub === 'reload') {
    api.bump()
    return { kind: 'success', text: `已清空文件缓存（${bumpCacheCount()} 项），下一轮组装重读规则文件。` }
  }

  if (sub === 'off' || sub === 'on') {
    state.enabled = sub === 'on'
    return { kind: 'success', text: state.enabled ? '已恢复注入。' : '已临时停用注入（section 仍在，但文本为空）。' }
  }

  return { kind: 'error', text: `未知子命令：${sub}\n\n${HELP}` }
}

/** 自增用的计数（只是给 reload 的提示加个数字）。 */
let cacheBumps = 0
function bumpCacheCount() {
  cacheBumps += 1
  return cacheBumps
}

/**
 * 注册 /zhcot 命令。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} state - 插件运行时状态。
 * @param {object} api - { version, config, getPlan, bump, ctx }。
 * @returns {boolean} 是否注册成功。
 */
export function registerCommands(ctx, state, api) {
  const commands = ctx.get?.('commands') ?? ctx.commands
  if (!commands?.register) return false
  try {
    commands.register({
      name: 'zhcot',
      description: '输出规则插件：状态、分层审计、规则集切换、临时停用',
      input: { hint: 'status | audit [--json] | list | use <id> | reload | off | on | help' },
      handler: (invocation) => {
        try {
          return handle(invocation?.rawInput ?? '', api, state)
        } catch (error) {
          return { kind: 'error', text: `zhcot 执行失败：${error?.message ?? error}` }
        }
      },
    })
    return true
  } catch {
    return false
  }
}

/**
 * 注册 zhcot_status 工具。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} state - 插件运行时状态。
 * @param {object} api - { version, config, getPlan, bump, ctx }。
 * @returns {boolean} 是否注册成功。
 */
export function registerTool(ctx, state, api) {
  const tools = ctx.get?.('tools') ?? ctx.tools
  if (!tools?.register) return false
  try {
    tools.register({
      name: 'zhcot_status',
      description: '查看 dsh-zh-cot-fidelity 当前注入状态：入口位置、文本来源与字符数、契约自检、最近一次系统提示组装统计。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      async execute() {
        return { text: statusText(api, state) }
      },
    })
    return true
  } catch {
    return false
  }
}
