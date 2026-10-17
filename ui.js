/**
 * 客户端面板的 HTTP 端点 —— 让 Web GUI 里的面板读写入口状态与规则文本。
 *
 * 走宿主 `connection.fetch.register()`（同源 fetch），不额外开端口、不碰 webServer。
 * 参考实现：`@deepseek-ai/dsh-session-log-export` 的 host 半。
 *
 * 路径约束（宿主强校验，违反即抛错）：必须挂在 `/api` 下，且每段匹配
 * `/^[A-Za-z0-9_$.-]+$/`。注册跑在 `ctx.inject` 的异步回调里，所以这里必须自己
 * try/catch —— 否则注册失败会被静默吞掉，前端只看到 404、日志里什么都没有。
 *
 * 安全约束：
 *   - 只接受规则目录下的 `<name>.md`，文件名用白名单正则，不拼接任意路径；
 *   - 写盘走临时文件 + rename（原子写），写前留 `.bak`；
 *   - 开关不直接改 YAML，交给宿主 `configEditor.edit()`（文件锁 + AST 改写 + 保留注释）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { activeRuleFile, pluginDir, rulesDir } from './entries.js'

/** 端点前缀。必须挂在 `/api` 下。 */
const BASE = '/api/zhcot-ui'

/** 本插件在 profile patch 里的行 id。 */
const PATCH_ID = 'zh-cot-fidelity'

/** 独占入口：开启它时，其余 `rules:` 来源的入口会被自动关闭。 */
const EXCLUSIVE_KEY = 'universal'

/** 通用模式的分组顺序：常用的在上，基础设施与未使用的在下。 */
const GROUP_ORDER = ['universal', 'scene', 'style', 'base', 'custom']

/** 分组标题。 */
const GROUP_TITLES = {
  base: '基础规则',
  scene: '场景模式',
  style: '题材描写',
  universal: '通用模式',
  custom: '自定义入口',
}

/** @param {string} key @param {{ source?: unknown }} spec @returns {string} 所属分组。 */
function groupOf(key, spec) {
  const source = String(spec?.source ?? '')
  if (source.startsWith('builtin:')) return 'base'
  if (key === EXCLUSIVE_KEY) return 'universal'
  if (key.startsWith('scene-')) return 'scene'
  if (key.startsWith('style-')) return 'style'
  return 'custom'
}

/** @returns {string} 通用模式开关快照文件。 */
function snapshotFile() {
  return path.join(pluginDir(), 'universal-snapshot.json')
}

/** @returns {{ entries: Record<string, boolean> } | null} 读快照；没有或损坏返回 null。 */
function readSnapshot() {
  try {
    const raw = JSON.parse(fs.readFileSync(snapshotFile(), 'utf8'))
    if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') return raw
  } catch { /* 没有快照，或快照坏了 —— 都按"无关可回溯"处理 */ }
  return null
}

/**
 * 写入快照。
 * @param {Record<string, boolean>} entries
 * @returns {boolean} 是否写成功。
 */
function writeSnapshot(entries) {
  try {
    fs.writeFileSync(snapshotFile(), `${JSON.stringify({ at: Date.now(), entries }, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

function clearSnapshot() {
  try { fs.unlinkSync(snapshotFile()) } catch { /* 已不存在 */ }
}

/** 合法规则文件名：字母数字下划线打头，中间允许 . 和 -，必须以 .md 结尾。 */
const RULE_FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,60}\.md$/

/** @param {unknown} data @param {number} [status] @returns {Response} */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * 把请求里的档名解析成绝对路径；不合法返回 null。
 * @param {unknown} name
 * @returns {string|null}
 */
function resolveRuleFile(name) {
  const base = String(name ?? '')
  if (!RULE_FILE_RE.test(base)) return null
  return path.join(rulesDir(), base)
}

/** @returns {Array<{name: string, chars: number}>} 规则目录下的 .md 清单。 */
function listRuleFiles() {
  const out = []
  try {
    for (const name of fs.readdirSync(rulesDir())) {
      if (!name.endsWith('.md')) continue
      let chars = 0
      try { chars = fs.readFileSync(path.join(rulesDir(), name), 'utf8').length } catch { /* 读不到记 0 */ }
      out.push({ name, chars })
    }
  } catch { /* 目录不存在 */ }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * 取一份规则档的首行标题，作为它的中文描述；读不到返回 null。
 * 这样新增档不用改代码，标题即描述。
 * @param {string} name
 * @returns {string|null}
 */
function titleOfRuleFile(name) {
  try {
    const text = fs.readFileSync(path.join(rulesDir(), name), 'utf8')
    const hit = text.match(/^#{1,3}[ \t]+(.+)$/m)
    return hit ? hit[1].trim() : null
  } catch {
    return null
  }
}

/** 内置规则组的说明：它们的文本在插件代码里，不是可编辑的数据。 */
const BUILTIN_NOTE = [
  '这一项是内置规则组，文本在插件代码 prompt.js 里，不能从这里编辑。',
  '',
  '要改的话有两条路：',
  '  · 编辑插件仓库的 prompt.js，重新部署并重启；',
  '  · 或者新建一份 rules/xxx.md，把内容写进去，再把对应入口的 source 指向 rules:xxx。',
].join('\n')

/**
 * 解析一个入口的编辑目标，三类：
 *   file    —— 规则目录下的 .md（`rules:<id>`；`file` 来源按 activeRuleFile 现算）
 *   config  —— profile 配置里的 `entries.<key>.text`（`inline` 来源）
 *   builtin —— 插件代码里的规则组，只读
 * @param {{ source?: unknown }} spec
 * @param {object} config
 * @returns {{ kind: 'file', name: string } | { kind: 'config' } | { kind: 'builtin' }}
 */
function editTargetOf(spec, config) {
  const source = String(spec?.source ?? '')
  if (source.startsWith('rules:')) return { kind: 'file', name: `${source.slice('rules:'.length)}.md` }
  if (source === 'file') return { kind: 'file', name: path.basename(activeRuleFile(config ?? {})) }
  if (source === 'inline') return { kind: 'config' }
  return { kind: 'builtin' }
}

/**
 * 入口的中文描述：`rules:` 档取首行标题，内置来源给固定说法。
 * @param {{ source?: unknown, text?: unknown }} spec
 * @returns {string}
 */
function labelOf(spec) {
  const source = String(spec?.source ?? '')
  if (source.startsWith('rules:')) {
    const name = `${source.slice('rules:'.length)}.md`
    return titleOfRuleFile(name) || name
  }
  if (source === 'builtin:rules') return '核心规则组（12 组）'
  if (source === 'builtin:boundary') return '边界声明与工具纪律'
  if (source === 'file') return '自定义规则文件'
  if (source === 'inline') {
    return String(spec?.text ?? '').trim() ? '内联文本' : '内联文本（未填写）'
  }
  return source || '未知来源'
}

/**
 * 安装 UI 端点。`connection` 用软依赖注入，缺失时只告警、不影响插件其余部分。
 * @param {object} ctx - 插件上下文。
 * @param {{ entries?: object, version?: string, getPlan: () => Array<{key: string, text: string}>, bump: () => void }} api
 */
export function installUiEndpoints(ctx, api) {
  ctx.inject(['connection'], (scope) => {
    const connection = scope.connection
    if (!connection?.fetch?.register) {
      ctx.logger?.warn?.('[dsh-zh-cot-fidelity] connection.fetch 不可用，客户端面板端点未注册')
      return
    }

    try {
      /** 注册一个端点；handler 抛错统一折成 500。 */
      const route = (method, pathname, handler) => {
        connection.fetch.register({
          path: `${BASE}${pathname}`,
          methods: [method],
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              return await handler(request)
            } catch (error) {
              return json({ error: String(error?.message ?? error) }, 500)
            }
          },
        })
      }

      // 状态：所有入口（含已禁用的）+ 规则档清单
      route('GET', '/state', () => {
        const plan = api.getPlan()
        const charsOf = (key) => plan.find((row) => row.key === key)?.text.length ?? null
        const entries = Object.entries(api.entries ?? {})
          .map(([key, spec]) => {
            const target = editTargetOf(spec, api.config)
            return {
              key,
              label: labelOf(spec),
              group: groupOf(key, spec),
              order: spec.order,
              source: String(spec.source ?? ''),
              enabled: spec.enabled !== false,
              chars: spec.enabled !== false ? charsOf(key) : null,
              editable: target.kind !== 'builtin',
              targetKind: target.kind,
              targetName: target.kind === 'file' ? target.name : null,
            }
          })
          .sort((a, b) => a.order - b.order)
        const snap = readSnapshot()
        return json({
          version: api.version ?? null,
          groups: GROUP_ORDER.map((id) => ({ id, title: GROUP_TITLES[id] })),
          entries,
          files: listRuleFiles(),
          snapshotAt: snap?.at ?? null,
        })
      })

      // 切换入口开关（交给宿主 configEditor，保留注释并触发热重载）
      route('POST', '/toggle', async (request) => {
        const body = await request.json().catch(() => null)
        const key = String(body?.key ?? '')
        const enabled = Boolean(body?.enabled)
        // 入口名与 config.js 的 ENTRY_KEY_RE 同一规则：避免把非法键写进 YAML。
        if (!/^[a-z][a-z0-9_-]{0,23}$/.test(key)) {
          return json({ error: `入口名不合法：${key || '(空)'}` }, 400)
        }
        const editor = ctx.get?.('configEditor')
        if (!editor?.edit || !editor?.entries) return json({ error: 'configEditor 服务不可用' }, 503)
        const target = editor.entries().find((entry) => entry.options?.id === PATCH_ID)
        if (!target) return json({ error: `找不到配置行 ${PATCH_ID}` }, 404)

        const entriesNow = api.entries ?? {}
        // 开启通用模式前先记下当时的开关状态，关闭时据此回溯。
        let snapshotToWrite = null
        if (key === EXCLUSIVE_KEY && enabled) {
          const before = {}
          for (const [other, spec] of Object.entries(entriesNow)) {
            if (other === key) continue
            if (!String(spec.source ?? '').startsWith('rules:')) continue
            before[other] = spec.enabled !== false
          }
          snapshotToWrite = before
        }

        await editor.edit(target, (current) => {
          const next = { ...current }
          const list = { ...(current?.entries ?? {}) }
          list[key] = { ...(list[key] ?? {}), enabled }

          // 通用模式与其余模式类入口**双向**互斥：
          //   · 开启它            → 其他 rules: 入口全关（开启前已存快照）
          //   · 关闭它            → 按快照回溯到开启前的状态
          //   · 它开着时开启别的档 → 自动关掉它（快照作废，因为不是回溯场景）
          // head / body 是 builtin 来源（边界声明与核心规则组），属基础设施，不参与互斥。
          const isRuleEntry = String(entriesNow[key]?.source ?? '').startsWith('rules:')
          if (key === EXCLUSIVE_KEY) {
            if (enabled) {
              for (const [other, spec] of Object.entries(entriesNow)) {
                if (other === key) continue
                if (!String(spec.source ?? '').startsWith('rules:')) continue
                list[other] = { ...(list[other] ?? {}), enabled: false }
              }
            } else {
              const snap = readSnapshot()
              if (snap?.entries) {
                for (const [other, wasEnabled] of Object.entries(snap.entries)) {
                  if (other === key || !(other in entriesNow)) continue
                  list[other] = { ...(list[other] ?? {}), enabled: wasEnabled === true }
                }
              }
            }
          } else if (enabled && isRuleEntry && entriesNow[EXCLUSIVE_KEY]?.enabled !== false) {
            list[EXCLUSIVE_KEY] = { ...(list[EXCLUSIVE_KEY] ?? {}), enabled: false }
          }

          next.entries = list
          return next
        })

        // edit 成功之后才动快照：写失败时保持原快照，下次仍能回溯。
        if (snapshotToWrite) writeSnapshot(snapshotToWrite)
        if (key === EXCLUSIVE_KEY && !enabled) clearSnapshot()
        // 从通用模式反向切到别的档时，旧快照失去意义，一并清掉。
        if (key !== EXCLUSIVE_KEY && enabled
          && String(entriesNow[key]?.source ?? '').startsWith('rules:')
          && entriesNow[EXCLUSIVE_KEY]?.enabled !== false) clearSnapshot()

        api.bump()
        return json({ ok: true, restored: key === EXCLUSIVE_KEY && !enabled })
      })

      // 读一个入口的文本（按 entry 解析目标，而不是按文件名）
      route('GET', '/text', (request) => {
        const key = new URL(request.url).searchParams.get('entry')
        const spec = api.entries?.[key]
        if (!spec) return json({ error: `未知入口：${key}` }, 404)
        const target = editTargetOf(spec, api.config)
        if (target.kind === 'builtin') {
          return json({ kind: 'builtin', entry: key, text: BUILTIN_NOTE, editable: false })
        }
        if (target.kind === 'config') {
          return json({ kind: 'config', entry: key, text: String(spec.text ?? ''), editable: true })
        }
        const file = resolveRuleFile(target.name)
        if (!file) return json({ error: `档名不合法：${target.name}` }, 400)
        try {
          return json({ kind: 'file', entry: key, name: target.name, text: fs.readFileSync(file, 'utf8'), editable: true })
        } catch {
          return json({ error: `读取失败：${target.name}` }, 404)
        }
      })

      // 写一个入口的文本：文件走原子写，inline 走 configEditor
      route('POST', '/text', async (request) => {
        const body = await request.json().catch(() => null)
        const key = String(body?.entry ?? '')
        if (!/^[a-z][a-z0-9_-]{0,23}$/.test(key)) {
          return json({ error: `入口名不合法：${key || '(空)'}` }, 400)
        }
        const spec = api.entries?.[key]
        if (!spec) return json({ error: `未知入口：${key}` }, 404)
        const target = editTargetOf(spec, api.config)
        const text = String(body?.text ?? '')

        if (target.kind === 'builtin') return json({ error: '内置规则组不可从这里编辑' }, 400)

        if (target.kind === 'config') {
          const editor = ctx.get?.('configEditor')
          if (!editor?.edit || !editor?.entries) return json({ error: 'configEditor 服务不可用' }, 503)
          const row = editor.entries().find((entry) => entry.options?.id === PATCH_ID)
          if (!row) return json({ error: `找不到配置行 ${PATCH_ID}` }, 404)
          await editor.edit(row, (current) => {
            const next = { ...current }
            const list = { ...(current?.entries ?? {}) }
            list[key] = { ...(list[key] ?? {}), text }
            next.entries = list
            return next
          })
          api.bump()
          return json({ ok: true, kind: 'config', chars: text.length })
        }

        const file = resolveRuleFile(target.name)
        if (!file) return json({ error: `档名不合法：${target.name}` }, 400)
        if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
        const tmp = `${file}.tmp`
        fs.writeFileSync(tmp, text, 'utf8')
        fs.renameSync(tmp, file)
        api.bump()
        return json({ ok: true, kind: 'file', name: target.name, chars: text.length })
      })

      ctx.logger?.info?.(`[dsh-zh-cot-fidelity] UI 端点已注册：${BASE}/{state,toggle,text}`)
    } catch (error) {
      ctx.logger?.error?.(`[dsh-zh-cot-fidelity] UI 端点注册失败：${error?.message ?? error}`)
    }
  })
}
