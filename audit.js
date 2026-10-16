/**
 * 诊断层 —— 只读审计。
 *
 * 挂 `system-prompt/assemble` waterfall，把每次组装后的
 * sections / contexts / tools 记一份快照（只存长度与前 200 字符，
 * 不留全文），然后按层给报告：
 *
 *   L1 用户规则层  入口、位置、来源、字符数
 *   L2 运行时策略层 sandbox / approval / subagent 三段是否在场、是哪一句
 *   L3 工具层      模型实际看得见的工具
 *   L4 表面层      是否有 complete section 顶掉全部
 *   L5 冲突与归因  策略文本里的禁止性措辞、当前执行策略
 *
 * 全程不修改 assembly，只调 next() 原样返回。
 */
import fs from 'node:fs'
import path from 'node:path'
import { auditDir } from './entries.js'
import { contractSummary } from './contract.js'

const HEAD_CHARS = 200
const POLICY_WORDS = /(禁止|不得|不要|不可|拒绝|do not|must not|may not|cannot|never|rejected)/i

/**
 * 记录一次组装快照。
 * @param {object} state - 插件运行时状态。
 * @param {object} assembly - waterfall 里的 PromptAssembly。
 */
function capture(state, assembly) {
  if (!assembly || typeof assembly !== 'object') return
  const sections = Array.isArray(assembly.sections) ? assembly.sections : []
  const contexts = Array.isArray(assembly.contexts) ? assembly.contexts : []
  const tools = Array.isArray(assembly.tools) ? assembly.tools : []
  const brief = (item) => {
    const text = String(item?.text ?? '')
    return { name: String(item?.name ?? '?'), chars: text.length, head: text.slice(0, HEAD_CHARS), policy: POLICY_WORDS.test(text) }
  }
  state.assembles = (state.assembles || 0) + 1
  state.last = {
    at: Date.now(),
    sections: sections.map(brief),
    contexts: contexts.map(brief),
    tools: tools.map((tool) => String(tool?.name ?? '?')),
    totalChars: sections.reduce((sum, item) => sum + String(item?.text ?? '').length, 0),
  }
}

/**
 * 注册 assemble 监听；任何异常都不影响宿主组装。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} state - 插件运行时状态。
 * @returns {() => void} disposer。
 */
export function installAudit(ctx, state) {
  const handler = (assembly, _context, next) => {
    try {
      capture(state, assembly)
    } catch { /* 审计失败不能影响组装 */ }
    return typeof next === 'function' ? next() : assembly
  }
  try {
    const dispose = ctx.on('system-prompt/assemble', handler)
    return typeof dispose === 'function' ? dispose : () => {}
  } catch (error) {
    state.auditError = `注册 system-prompt/assemble 监听失败：${error?.message ?? error}`
    return () => {}
  }
}

/** 找一段文本里最像"策略声明"的那句。 */
function keySentence(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > HEAD_CHARS ? `${clean.slice(0, HEAD_CHARS)}…` : clean
}

/**
 * 生成分层审计报告。
 * @param {object} ctx - 插件上下文。
 * @param {object} state - 插件运行时状态。
 * @param {Record<string, unknown>} config - 归一化后的配置。
 * @param {Array<object>} entries - renderEntries 的结果。
 * @returns {string} 纯文本报告。
 */
export function buildReport(ctx, state, config, entries) {
  const lines = []
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  lines.push(`【zh-cot-fidelity 审计】${stamp}`)
  lines.push(`契约自检：${contractSummary(state.contract)}`)
  if (state.auditError) lines.push(`审计监听：${state.auditError}`)
  lines.push('')

  // L1 用户规则层
  lines.push('── L1 用户规则层 ──')
  const registered = entries.length ? entries : []
  if (!registered.length) lines.push('  没有任何入口生效（全部关闭或内容为空）')
  for (const item of registered) {
    lines.push(`  ${item.key.padEnd(6)} ${String(item.order).padStart(8)}  ${item.name}  ${item.text.length} 字符  来源=${item.source}  插值=${item.interpolate ? '开' : '关'}`)
  }
  lines.push('')

  const last = state.last
  if (!last) {
    lines.push('── 组装快照：尚未捕获到（重启后开一轮对话即可）──')
    return lines.join('\n')
  }

  // L2 运行时策略层
  lines.push('── L2 运行时策略层 ──')
  const wanted = ['sandbox:policy', 'approval:policy', 'subagent:delegation']
  const contextNames = last.contexts.map((item) => item.name)
  for (const name of wanted) {
    const hit = last.contexts.find((item) => item.name === name)
    if (!hit) {
      lines.push(`  ${name.padEnd(20)} ${config.suppressRuntimeContext ? '已撤下（本插件 suppressRuntimeContext）' : '不在场'}`)
      continue
    }
    lines.push(`  ${name.padEnd(20)} 在场 ${String(hit.chars).padStart(5)} 字符  ${keySentence(hit.head)}`)
  }
  const others = last.contexts.filter((item) => !wanted.includes(item.name))
  if (others.length) lines.push(`  其他 context：${others.map((item) => `${item.name}(${item.chars})`).join('、')}`)
  lines.push('')

  // L3 工具层 + L4 表面层
  const ours = last.sections.filter((item) => item.name.startsWith('dsh:zh-cot-fidelity'))
  const ourChars = ours.reduce((sum, item) => sum + item.chars, 0)
  const share = last.totalChars ? ((ourChars / last.totalChars) * 100).toFixed(1) : '0.0'
  lines.push('── L3 工具层 / L4 表面层 ──')
  lines.push(`  sections 共 ${last.sections.length} 段，合计 ${last.totalChars} 字符`)
  lines.push(`  本插件贡献 ${ours.length} 段 / ${ourChars} 字符（占比 ${share}%）`)
  lines.push(`  模型可见工具 ${last.tools.length} 个${last.tools.length ? `：${last.tools.slice(0, 12).join('、')}${last.tools.length > 12 ? ' …' : ''}` : ''}`)
  lines.push('')
  lines.push('  字符数最多的 5 段：')
  for (const item of [...last.sections].sort((a, b) => b.chars - a.chars).slice(0, 5)) {
    lines.push(`    ${String(item.chars).padStart(6)}  ${item.name}`)
  }
  lines.push('')

  // L5 冲突与执行层归因
  lines.push('── L5 冲突与执行层归因 ──')
  const policyTexts = [...last.sections, ...last.contexts].filter((item) => item.policy && !item.name.startsWith('dsh:zh-cot-fidelity'))
  lines.push(`  含禁止性措辞的外来文本：${policyTexts.length} 段${policyTexts.length ? `（${policyTexts.slice(0, 6).map((item) => item.name).join('、')}）` : ''}`)
  const approval = last.contexts.find((item) => item.name === 'approval:policy')
  if (approval) {
    const never = /disabled in this session/i.test(approval.head)
    lines.push(`  审批策略：${never ? 'never（宿主注入 “会被自动拒绝、不要请求升级” 句）' : 'ask（宿主注入 “可能询问，无应答方则失败关闭” 句）'}`)
    if (never && !config.suppressRuntimeContext) {
      lines.push('  → 想要模型不再读到这句：打开 suppressRuntimeContext（只撤告知，不改执行策略）')
    }
  } else if (config.suppressRuntimeContext) {
    lines.push('  审批策略：告知已撤下；执行策略本身未变（要看实际策略请用 /permission）')
  }
  const sandbox = [...last.sections, ...last.contexts].find((item) => /file policy:/i.test(item.head))
  if (sandbox) {
    const mode = sandbox.head.match(/file policy:\s*([a-z-]+)/i)
    lines.push(`  文件策略：${mode ? mode[1] : '见上文（未能解析）'}（来源 ${sandbox.name}）`)
  }
  lines.push('  放开执行要走官方通道：/permission（沙箱模式 + 审批策略一起切，按会话记录、可回滚）')
  return lines.join('\n')
}

/**
 * 需要时把审计快照落盘（保留 auditKeep 份）。
 * @param {Record<string, unknown>} config - 归一化后的配置。
 * @param {object} state - 插件运行时状态。
 * @returns {string|null} 写入的文件路径。
 */
export function writeAudit(config, state) {
  const dir = String(config.auditDir || '').trim() || auditDir()
  if (!String(config.auditDir || '').trim()) return null
  if (!state.last) return null
  try {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(file, `${JSON.stringify({ at: state.last.at, totalChars: state.last.totalChars, sections: state.last.sections, contexts: state.last.contexts, tools: state.last.tools }, null, 2)}\n`, 'utf8')
    const keep = Number.isFinite(config.auditKeep) ? Math.max(1, Number(config.auditKeep)) : 20
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    for (const name of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch { /* 删不掉就算了 */ }
    }
    return file
  } catch {
    return null
  }
}
