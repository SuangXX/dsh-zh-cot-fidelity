/**
 * 客户端面板 —— 侧边栏底部一个按钮，点开浮层管理「内容模块」。
 *
 * 手写纯 CJS，不经打包：`__ModuleLoader__.load({ id, factory })` 的 factory 会收到
 * 宿主的 `require`，React 直接从 `react` 取。
 *
 * 两个 slot 各管一半：
 *   - `sidebar.footer.action`  入口按钮
 *   - `shell.overlay`          浮层本体（宿主的全屏浮层容器，不受侧边栏 transform 影响）
 * 两者通过模块级 `open` 状态 + 订阅通信。
 *
 * 数据走同源 fetch，端点由 host 半通过 `connection.fetch.register()` 提供，
 * **路径必须挂在 `/api` 下**（宿主校验，否则注册即抛错）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-zh-cot-fidelity',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/zhcot-ui'
    const MUTED = 'rgba(127,127,127,1)'
    const DANGER = '#c0392b'
    const LINE = '1px solid rgba(127,127,127,.24)'

    /** 分组之间的分隔图案。 */
    const SEPARATOR_TEXT = '◇□◇□◇'
    const separator = {
      textAlign: 'center',
      color: MUTED,
      fontSize: 11,
      letterSpacing: 3,
      padding: '8px 0 2px',
      marginTop: 6,
      borderTop: LINE,
    }
    const groupTitle = { fontSize: 11, color: MUTED, padding: '2px 0 0' }

    const mask = {
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      background: 'rgba(0,0,0,.45)',
    }

    const panel = {
      width: 'min(94vw, 460px)',
      maxHeight: '82vh',
      overflowY: 'auto',
      padding: 14,
      borderRadius: 12,
      background: '#fff',
      color: '#111',
      fontSize: 13,
      lineHeight: 1.5,
      boxShadow: '0 16px 48px rgba(0,0,0,.30)',
    }

    const smallBtn = {
      fontSize: 12,
      padding: '3px 10px',
      borderRadius: 6,
      border: '1px solid rgba(127,127,127,.4)',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
    }

    // ── 跨组件状态：按钮在 footer，浮层在 shell.overlay ──
    let open = false
    const listeners = new Set()
    const setOpen = (value) => {
      open = value
      for (const notify of listeners) notify()
    }
    function useOpen() {
      const [, bump] = React.useReducer((n) => n + 1, 0)
      React.useEffect(() => {
        listeners.add(bump)
        return () => { listeners.delete(bump) }
      }, [])
      return open
    }

    /** 统一请求封装：非 JSON 响应也不吞内容，便于看到 404 的正文。 */
    async function call(path, init) {
      const res = await fetch(API + path, init)
      const text = await res.text()
      let body = {}
      try { body = JSON.parse(text) } catch { body = { error: text.slice(0, 300) || `HTTP ${res.status}` } }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      return body
    }

    /** 侧边栏底部的入口按钮。 */
    function Launcher() {
      const isOpen = useOpen()
      return h('button', {
        type: 'button',
        title: '输出规则',
        onClick: () => setOpen(!isOpen),
        style: { ...smallBtn, padding: '4px 10px' },
      }, isOpen ? '收起规则' : '输出规则')
    }

    /** 管理浮层。 */
    function Overlay() {
      const isOpen = useOpen()
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [editing, setEditing] = React.useState(null)
      const [draft, setDraft] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          setData(await call('/state'))
          setErr(null)
        } catch (error) {
          setErr(String(error?.message ?? error))
        }
      }, [])

      React.useEffect(() => { if (isOpen) load() }, [isOpen, load])

      if (!isOpen) return null

      const toggle = async (entry) => {
        setBusy(true)
        try {
          await call('/toggle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: entry.key, enabled: !entry.enabled }),
          })
          await load()
        } catch (error) {
          setErr(String(error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }

      const openEditor = async (entry) => {
        try {
          const body = await call(`/text?entry=${encodeURIComponent(entry.key)}`)
          setEditing({
            key: entry.key,
            title: body.kind === 'file' ? `${body.name} · ${entry.label || entry.key}` : (entry.label || entry.key),
            readonly: body.editable === false,
          })
          setDraft(String(body.text ?? ''))
          setErr(null)
        } catch (error) {
          setErr(String(error?.message ?? error))
        }
      }

      const save = async () => {
        if (!editing || editing.readonly) return
        setBusy(true)
        try {
          await call('/text', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entry: editing.key, text: draft }),
          })
          setEditing(null)
          setDraft('')
          await load()
        } catch (error) {
          setErr(String(error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }

      const row = (entry) => h('div', {
        key: entry.key,
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: LINE },
      },
        h('input', {
          type: 'checkbox',
          checked: !!entry.enabled,
          disabled: busy,
          onChange: () => toggle(entry),
        }),
        h('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3 } },
          h('span', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.label || entry.key),
          h('span', { style: { color: MUTED, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.key),
        ),
        h('span', { style: { color: MUTED, fontSize: 11, minWidth: 52, textAlign: 'right' } },
          entry.enabled ? `${entry.chars ?? 0} 字` : '已关闭',
        ),
        h('button', {
          style: { ...smallBtn, opacity: entry.editable ? 1 : 0.6 },
          disabled: busy,
          onClick: () => openEditor(entry),
        }, entry.editable ? '编辑' : '查看'),
      )

      const editor = () => h('div', { style: { borderTop: LINE, marginTop: 10, paddingTop: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
          h('strong', { style: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, editing.title),
          h('button', { style: smallBtn, disabled: busy || editing.readonly, onClick: save }, busy ? '保存中…' : '保存'),
          h('button', { style: smallBtn, onClick: () => { setEditing(null); setDraft('') } }, '取消'),
        ),
        h('textarea', {
          value: draft,
          rows: 14,
          spellCheck: false,
          readOnly: editing.readonly === true,
          onChange: (event) => setDraft(event.target.value),
          style: {
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            padding: 8,
            borderRadius: 8,
            border: LINE,
            resize: 'vertical',
          },
        }),
      )

      // 有未保存的编辑时先确认，避免误点遮罩丢掉草稿。
      const close = () => {
        if (!editing || window.confirm('还有未保存的修改，确定关闭？')) setOpen(false)
      }

      // 按功能分组渲染：组与组之间用 ◇□◇□◇ 分隔。
      const renderGroups = () => {
        if (!data) return null
        const groups = Array.isArray(data.groups) && data.groups.length
          ? data.groups
          : [{ id: 'custom', title: '' }]
        const out = []
        for (const group of groups) {
          const rows = data.entries.filter((entry) => (entry.group || 'custom') === group.id)
          if (!rows.length) continue
          if (out.length) out.push(h('div', { key: `sep-${group.id}`, style: separator }, SEPARATOR_TEXT))
          if (group.title) out.push(h('div', { key: `title-${group.id}`, style: groupTitle }, group.title))
          for (const entry of rows) out.push(row(entry))
        }
        return out
      }

      return h('div', {
        style: mask,
        onClick: (event) => { if (event.target === event.currentTarget) close() },
      },
        h('div', { style: panel },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
            h('strong', { style: { flex: 1, fontSize: 14 } }, '输出规则'),
            data ? h('span', { style: { color: MUTED, fontSize: 11 } },
              `v${data.version} · 启用 ${data.entries.filter((entry) => entry.enabled).length}/${data.entries.length}`,
            ) : null,
            h('button', { style: smallBtn, onClick: load }, '刷新'),
            h('button', { style: smallBtn, onClick: close }, '关闭'),
          ),
          err ? h('div', { style: { color: DANGER, fontSize: 11, marginBottom: 8, wordBreak: 'break-all' } }, err) : null,
          !data && !err ? h('div', { style: { color: MUTED } }, '加载中…') : null,
          // 编辑时只显示编辑器：列表隐藏，避免"列表 + 长文本框"把浮层撑歪、滚动位置乱跳。
          editing ? editor() : (data ? renderGroups() : null),
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'zhcot-panel',
        order: 20,
      }, Launcher))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'zhcot-panel',
        order: 0,
      }, Overlay))
    }

    return { inject: ['slots'], apply }
  },
})
