/**
 * DSH 契约自检 —— 这个插件依赖的宿主接口是否还长着原样。
 *
 * 段位、context 名、服务方法都是宿主内部常量，dsh 升级可能改。
 * 与其静默失效，不如启动时对一遍，把结果放进 /zhcot status 与审计报告。
 */
/**
 * 依赖的段位常量：[类型, 名字, 期望值, 说明]。
 *
 * 这里的「名字」是宿主 `SECTION_ORDERS` / `CONTEXT_ORDERS` 的**常量 key**
 * （`HARNESS_IDENTITY`、`SANDBOX_POLICY`…），用途是查 order。
 * 它和注册进 assembly 的 section / context 的 **name 字段**不是一回事：
 * 例如 context 的真正注册名是 `sandbox:policy` / `approval:policy` / `subagent:delegation`
 * （见 audit.js 的 L2 段），而常量 key 是 `SANDBOX_POLICY`。
 * 两套名字都正确，只是处在不同层 —— 排查时别把两者当成不一致。
 */
export const CONTRACT = [
  ['section', 'HARNESS_IDENTITY', -1000, '身份段排在最前'],
  ['section', 'WEB_SURFACE', 10100, '表面段在用户规则之前'],
  ['section', 'DEPLOYMENT_PERSONA_SUFFIX', 10200, 'persona 后缀在最后'],
  ['context', 'SANDBOX_POLICY', 110, '沙箱策略文本'],
  ['context', 'APPROVAL_POLICY', 115, '审批策略文本'],
  ['context', 'SUBAGENT_DELEGATION', 120, '子代理策略文本'],
]

/**
 * 跑一遍契约自检。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @returns {{ ok: boolean, checks: Array<{ id: string, label: string, expected: unknown, actual: unknown, ok: boolean }> }}
 */
export function checkContract(ctx) {
  const checks = []
  const prompt = ctx?.systemPrompt

  checks.push({
    id: 'service',
    label: 'systemPrompt 服务',
    expected: 'object',
    actual: prompt ? 'object' : String(prompt),
    ok: Boolean(prompt),
  })
  checks.push({
    id: 'section()',
    label: 'systemPrompt.section()',
    expected: 'function',
    actual: typeof prompt?.section,
    ok: typeof prompt?.section === 'function',
  })
  checks.push({
    id: 'suppressRuntimeContext()',
    label: 'systemPrompt.suppressRuntimeContext()',
    expected: 'function',
    actual: typeof prompt?.suppressRuntimeContext,
    ok: typeof prompt?.suppressRuntimeContext === 'function',
  })

  for (const [kind, name, expected, label] of CONTRACT) {
    let actual
    try {
      actual = kind === 'section' ? prompt?.getSectionOrder?.(name) : prompt?.getContextOrder?.(name)
    } catch (error) {
      actual = `throw: ${error?.message ?? error}`
    }
    checks.push({
      id: `${kind}:${name}`,
      label: `${label}（${name}）`,
      expected,
      actual,
      ok: actual === expected,
    })
  }

  // 这里原本还有一项「section 名是否被占用」的检查，但它比较的是 SECTION 与 SECTION
  // 两个同一个常量，恒为真 —— 既没检查任何东西，又让自检项数虚高一项，已删除。
  // 真要检测占用，需要宿主提供「列出已注册 section 名」的接口，systemPrompt 目前没有。
  return { ok: checks.every((item) => item.ok), checks }
}

/**
 * 把自检结果压成一行摘要。
 * @param {{ ok: boolean, checks: Array<{ ok: boolean }> }} report - checkContract 的返回值。
 * @returns {string} 形如 `契约 7/8 通过`。
 */
export function contractSummary(report) {
  if (!report) return '契约 未检查'
  const pass = report.checks.filter((item) => item.ok).length
  return `契约 ${pass}/${report.checks.length} ${report.ok ? '通过' : '有失败项'}`
}
