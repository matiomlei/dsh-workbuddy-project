/**
 * The browser half: one settings page that configures projects.
 *
 * Hand-authored in the shell's module-loader format, so this package needs no
 * bundler. Its only external is React, which the shell seeds in the baseline
 * module table; everything else is plain DOM through `createElement`.
 *
 * The page talks to the Host through the ordinary same-origin Fetch route the
 * host half registered under `/api`, so the session cookie and the browser
 * trust fence apply exactly as they do to every other Host call.
 *
 * @module dsh-workbuddy-project/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-workbuddy-project',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** The Host route the host half registered. */
    const ROUTE = '/api/workbuddy-project'

    /**
     * Call one Host action.
     * @param action - the action name.
     * @param payload - action fields.
     * @returns the action's value.
     */
    async function call(action, payload) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(payload ?? {}) }),
      })
      if (!response.ok) throw new Error(`Host 返回 ${response.status}`)
      const body = await response.json()
      if (body === null || body.ok !== true) throw new Error(body?.error?.message ?? '未知错误')
      return body.value
    }

    const MUTED = 'color-mix(in srgb, currentColor 62%, transparent)'
    const LINE = '1px solid color-mix(in srgb, currentColor 12%, transparent)'
    const FILL = 'color-mix(in srgb, currentColor 6%, transparent)'

    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: '20px', fontSize: '14px', lineHeight: 1.55 },
      bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      spacer: { flex: '1 1 auto' },
      muted: { color: MUTED },
      card: {
        border: LINE,
        borderRadius: '10px',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        background: FILL,
      },
      cardPick: { cursor: 'pointer' },
      cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: '16px' },
      projectCards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, max(210px, calc(50% - 6px))), 1fr))', gap: '12px' },
      projectCard: { padding: '14px', borderRadius: '12px', gap: '8px' },
      itemCard: { padding: '20px', borderRadius: '18px', gap: '14px', minWidth: 0, overflowWrap: 'anywhere', background: 'var(--dsw-alias-bg-layer-1, Canvas)' },
      tag: { padding: '2px 7px', borderRadius: '6px', background: FILL, color: MUTED, fontSize: '11px' },
      cardAction: { marginTop: 'auto', textAlign: 'right', color: MUTED, fontSize: '12px' },
      grid: { display: 'grid', gridTemplateColumns: 'minmax(120px, 170px) 1fr', gap: '8px 10px', alignItems: 'start' },
      label: { color: MUTED, paddingTop: '5px' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px 12px',
        borderRadius: '10px',
        border: LINE,
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' },
      button: {
        padding: '8px 14px',
        borderRadius: '10px',
        border: LINE,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      },
      primary: { borderColor: 'transparent', background: 'var(--dsw-alias-label-primary, CanvasText)', color: 'var(--dsw-alias-bg-layer-1, Canvas)' },
      error: { color: '#c0392b', whiteSpace: 'pre-wrap' },
      ok: { color: '#2e7d32', whiteSpace: 'pre-wrap' },
      pre: {
        margin: 0,
        padding: '10px',
        border: LINE,
        borderRadius: '8px',
        background: FILL,
        maxHeight: '320px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      chip: {
        padding: '3px 10px',
        borderRadius: '999px',
        border: LINE,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
      },
      chipOn: {
        padding: '3px 10px',
        borderRadius: '999px',
        border: LINE,
        background: FILL,
        color: MUTED,
        cursor: 'default',
        font: 'inherit',
        fontSize: '12px',
      },
      section: { display: 'flex', flexDirection: 'column', gap: '6px' },
      sectionHead: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' },
      chips: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' },
      groupLabel: { color: MUTED, fontSize: '12px', minWidth: '76px' },
      selected: {
        display: 'inline-flex',
        gap: '4px',
        alignItems: 'center',
        padding: '3px 4px 3px 10px',
        borderRadius: '999px',
        border: LINE,
        background: FILL,
        fontSize: '12px',
      },
      badge: {
        padding: '0 5px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-label-primary, CanvasText)',
        color: 'var(--dsw-alias-bg-layer-1, Canvas)',
        fontSize: '10px',
        lineHeight: '16px',
      },
      chipX: {
        border: 'none',
        background: 'transparent',
        color: MUTED,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '1',
        padding: '0 4px',
      },
    }

    /** Use the shell's theme and the browser's modal focus/keyboard handling. */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      const style = document.getElementById('workbuddy-card-styles') ?? document.createElement('style')
      style.id = 'workbuddy-card-styles'
      style.textContent = `
        .wb-item-card { transition: border-color .15s, box-shadow .15s, transform .15s; }
        .wb-item-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,.06); transform: translateY(-1px); }
        .wb-root button:disabled, .wb-modal button:disabled { opacity: .45; cursor: not-allowed !important; }
        .wb-root input:focus-visible, .wb-modal input:focus-visible, .wb-modal textarea:focus-visible, .wb-modal select:focus-visible { outline: 2px solid var(--dsw-alias-label-primary, currentColor); outline-offset: 2px; }
        .wb-button:hover:not(:disabled) { filter: brightness(.94); }
        .wb-description { color: color-mix(in srgb, currentColor 65%, transparent); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.7; }
        .wb-avatar { flex-shrink: 0; display: inline-grid; place-items: center; overflow: hidden; vertical-align: middle; }
        .wb-library-list .wb-item-card { padding: 14px; gap: 10px; border-radius: 12px; }
        .wb-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .wb-item-card:hover, .wb-item-card:focus-visible { border-color: var(--dsw-alias-border-l3, currentColor) !important; }
        .wb-item-card:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        .wb-modal { width: min(860px, 92vw); max-width: 92vw; max-height: 86vh; padding: 0;
          box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, #888); border-radius: 22px;
          background: var(--dsw-alias-bg-layer-1, Canvas); color: var(--dsw-alias-label-primary, CanvasText);
          font: inherit; font-size: 14px; line-height: 1.6; overflow: hidden; }
        .wb-modal[open] { display: flex; flex-direction: column; }
        .wb-modal::backdrop { background: rgba(0,0,0,.45); }
        .wb-modal-head { display: flex; align-items: center; gap: 14px; padding: 22px 28px;
          border-bottom: 1px solid var(--dsw-alias-border-l2, #888); flex-shrink: 0; }
        .wb-modal-body { display: flex; flex-direction: column; gap: 20px; padding: 24px 28px;
          overflow: auto; min-height: 0; overflow-wrap: anywhere; }
        .wb-modal-footer { padding: 18px 28px; border-top: 1px solid var(--dsw-alias-border-l2, #888); flex-shrink: 0; }
        .wb-modal-head strong { font-size: 20px; font-weight: 650; }
        .wb-picker { width: min(1100px, 92vw); }
        @media (max-width: 560px) { .wb-modal-body { padding: 14px; } .wb-modal-body .wb-form-grid { grid-template-columns: 1fr !important; } }
      `
      if (!style.isConnected) document.head.appendChild(style)
    }

    function Modal({ title, onClose, busy, children, footer, className }) {
      const dialogRef = useRef(null)
      const titleId = React.useId()
      useEffect(() => {
        const dialog = dialogRef.current
        const previousOverflow = document.body.style.overflow
        dialog.showModal()
        document.body.style.overflow = 'hidden'
        return () => {
          dialog.close()
          document.body.style.overflow = previousOverflow
        }
      }, [])
      return h('dialog', {
        ref: dialogRef, className: `wb-modal ${className ?? ''}`, 'aria-labelledby': titleId,
        onCancel: (event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose() },
        onClick: (event) => {
          if (busy || event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
        },
      },
        h('div', { className: 'wb-modal-head' },
          h('strong', { id: titleId }, title),
          h('span', { style: S.spacer }),
          button('关闭', onClose, { disabled: busy }),
        ),
        h('div', { className: 'wb-modal-body' }, children),
        footer ? h('div', { className: 'wb-modal-footer' }, footer) : null,
      )
    }

    function cardProps(label, onOpen, busy) {
      return {
        className: 'wb-item-card', style: { ...S.card, ...S.itemCard, ...S.cardPick },
        role: 'button', tabIndex: busy ? -1 : 0, 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-disabled': busy,
        onClick: (event) => { if (!busy) { event.currentTarget.focus(); onOpen() } },
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget || busy || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault(); onOpen()
        },
      }
    }

    function field(label, control) {
      return [h('div', { key: `${label}-l`, style: S.label }, label), h('div', { key: `${label}-c` }, control)]
    }

    function button(label, onClick, extra) {
      return h('button', { type: 'button', className: 'wb-button', style: { ...S.button, ...(extra ?? {}) }, onClick, disabled: extra?.disabled }, label)
    }

    /**
     * One row of pickable values, grouped by where they come from.
     *
     * A chosen value renders disabled rather than clickable, so the same entry
     * cannot be added twice and its source stays visible in the group label.
     */
    function optionRow(label, items, chosen, onAdd) {
      if (items.length === 0) return null
      return h('div', { key: label, style: S.chips },
        h('span', { style: S.groupLabel }, label),
        ...items.map((item) => {
          const on = chosen.has(item.value)
          return h('button', {
            key: item.value,
            type: 'button',
            title: item.title ?? item.value,
            style: on ? S.chipOn : S.chip,
            disabled: on,
            onClick: () => { if (!on) onAdd(item.value) },
          }, on ? `✓ ${item.value}` : item.value)
        }),
      )
    }

    const ICON_DEFAULTS = { expert: ['🧑‍💼', '#e9f2ff'], skill: ['⚡', '#fff1dc'], rule: ['📋', '#e6f5ef'], connector: ['🔗', '#eeeaff'], project: ['📁', '#e9eff8'] }
    const kindForLabel = (label) => label.includes('专家') ? 'expert' : label.includes('技能') ? 'skill' : label.includes('规范') ? 'rule' : 'connector'
    const capabilityLabel = (label) => label

    /** Image failures and legacy entries always retain a recognisable category icon. */
    function CapabilityIcon({ item = {}, kind, size = 44 }) {
      const [failed, setFailed] = useState(false)
      const value = item.iconUrl ?? item.icon ?? ''
      useEffect(() => { setFailed(false) }, [value])
      const [fallback, background] = ICON_DEFAULTS[kind ?? item.kind] ?? ICON_DEFAULTS.skill
      const image = /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,)/i.test(value)
      const emoji = !image && value.length <= 32 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value) ? value : fallback
      return h('span', { className: 'wb-avatar', 'aria-hidden': true, 'data-kind': kind ?? item.kind,
        style: { width: size, height: size, borderRadius: Math.round(size * .26), background: image && !failed ? FILL : background, fontSize: Math.round(size * .51), lineHeight: 1 } },
        image && !failed ? h('img', { src: value, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onError: () => setFailed(true) }) : emoji)
    }

    function IconEditor({ editor, onChange, busy }) {
      const [error, setError] = useState(null)
      const uploadVersion = useRef(0)
      useEffect(() => () => { uploadVersion.current++ }, [])
      async function upload(event) {
        const file = event.target.files?.[0]
        if (!file) return
        const version = ++uploadVersion.current
        setError(null)
        try {
          if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG、GIF 或 WebP 图片')
          if (file.size > 256 * 1024) throw new Error('图标图片不能超过 256 KB')
          const value = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file)
          })
          if (version === uploadVersion.current) onChange({ icon: value, iconUrl: value, iconDirty: true })
        } catch (problem) { if (version === uploadVersion.current) setError(problem.message) }
        event.target.value = ''
      }
      const change = (icon) => { uploadVersion.current++; setError(null); onChange({ icon, iconUrl: undefined, iconDirty: true }) }
      const embedded = editor.icon?.startsWith('data:')
      return h('div', { style: S.section },
        h('div', { style: { ...S.bar, alignItems: 'flex-start' } },
          h(CapabilityIcon, { item: editor, kind: editor.kind, size: 56 }),
          h('div', { style: { ...S.section, flex: 1, minWidth: 160 } },
            h('input', { style: S.input, 'aria-label': '图标', value: embedded ? '' : editor.icon ?? '', disabled: busy,
              placeholder: embedded ? '已上传图片，可输入 Emoji 或链接替换' : 'Emoji、图片链接或相对图片路径', onChange: (event) => change(event.target.value) }),
            h('div', { style: S.bar }, ...['📋', '🧑‍💼', '⚡', '🔗', '🛠️', '🎨', '📊', '🚀'].map((icon) => h('button', {
              key: icon, type: 'button', style: { ...S.button, padding: '5px 8px' }, 'aria-label': `使用图标 ${icon}`, 'aria-pressed': editor.icon === icon, disabled: busy, onClick: () => change(icon),
            }, icon)), button('恢复默认', () => change(''), { disabled: busy })),
            h('label', { style: S.muted }, '上传图片（256 KB 内）', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', 'aria-label': '上传图标', disabled: busy, onChange: upload, style: { display: 'block', marginTop: 6, maxWidth: '100%' } })),
          )),
        error ? h('div', { role: 'alert', style: S.error }, error) : null,
      )
    }

    /** Selection is staged in this dialog; cancel never changes the project draft. */
    function CapabilityPicker({ label, groups, selected, onConfirm, onClose, pending, loadError, onRefresh }) {
      const [values, setValues] = useState([...selected])
      const [query, setQuery] = useState('')
      const [source, setSource] = useState('全部')
      const candidates = [...new Map(groups.flatMap((group) => group.items.map((item) => ({ ...item, source: group.label }))).map((item) => [item.value, item])).values()]
      const search = query.trim().toLocaleLowerCase()
      const visible = candidates.filter((item) => (source === '全部' || item.source === source) && `${item.name ?? item.value} ${item.description ?? ''} ${item.value}`.toLocaleLowerCase().includes(search))
      const toggle = (value) => setValues((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value])
      return h(Modal, { title: `选择${capabilityLabel(label)}`, onClose, className: 'wb-picker', footer: h('div', { style: S.bar },
        h('span', { style: S.muted }, `已选 ${values.length} 项`), h('span', { style: S.spacer }),
        button('取消', onClose), button('确认', () => onConfirm(values), { ...S.primary }),
      ) },
        h('div', { style: S.bar }, h('input', { style: { ...S.input, flex: 1 }, placeholder: `搜索${label}`, 'aria-label': `搜索${label}`, value: query, onChange: (event) => setQuery(event.target.value) }),
          onRefresh ? button('刷新选项', onRefresh, { disabled: pending }) : null),
        h('div', { style: S.bar, role: 'tablist', 'aria-label': '能力来源' }, ...['全部', ...new Set(groups.map((group) => group.label))].map((name) => h('button', {
          key: name, type: 'button', role: 'tab', 'aria-selected': source === name,
          style: { ...S.button, ...(source === name ? { background: FILL } : {}) }, onClick: () => setSource(name),
        }, name))),
        pending ? h('div', { role: 'status', style: S.muted }, '正在加载可选能力…') : null,
        loadError ? h('div', { role: 'alert', style: S.error }, loadError) : null,
        h('div', { style: S.cards }, ...visible.map((item) => {
          const chosen = values.includes(item.value)
          return h('button', { key: item.value, type: 'button', className: 'wb-item-card', 'aria-pressed': chosen, disabled: !!item.disabled,
            title: item.title ?? item.value, onClick: () => toggle(item.value),
            style: { ...S.card, ...S.button, ...S.itemCard, padding: '18px', textAlign: 'left', minHeight: '168px', ...(chosen ? { borderColor: 'currentColor', background: FILL } : {}) },
          }, h('div', { style: S.bar }, h(CapabilityIcon, { item, kind: kindForLabel(label), size: 44 }),
            h('strong', { style: { flex: 1 } }, item.name ?? item.value), h('span', { 'aria-hidden': true }, chosen ? '✓' : '+')),
            h('div', { style: { ...S.muted, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, item.disabled ?? item.description ?? '查看并选择此能力'),
            h('div', { style: { ...S.muted, marginTop: 'auto', fontSize: '11px' } }, sourceName(`${item.source}${item.library ? ` · ${item.library}` : ''}`)))
        })),
        !pending && !loadError && visible.length === 0 ? h('div', { role: 'status', style: S.muted }, candidates.length === 0 ? `团队共享和 DSH 本地暂无可选${label}，可维护配置后刷新。` : '没有匹配的能力，请调整搜索或来源。') : null,
      )
    }

    /** Compact optional box with removable selections, matching the project editor. */
    function ListField({ label, hint, selected, groups = [], ordered, primaryHint, onChange, pending, loadError, onRefresh }) {
      const [open, setOpen] = useState(false)
      const available = new Map()
      for (const item of groups.flatMap((group) => group.items)) {
        for (const value of [item.value, ...(item.aliases ?? [])]) if (!available.has(value)) available.set(value, item)
      }
      const selectedKeys = [...new Set(selected.map((value) => available.get(value)?.value ?? value))]
      return h('div', { style: { ...S.section, border: LINE, borderRadius: '16px', padding: '18px 20px', gap: '14px' } },
        h('div', { style: S.bar }, h('strong', null, capabilityLabel(label)), h('span', { style: S.muted }, '（可选）'), h('span', { style: S.spacer }),
          h('button', { type: 'button', style: { ...S.button, border: 'none' }, 'aria-label': `添加${label}`, onClick: () => setOpen(true) }, '+ 添加')),
        hint ? h('div', { style: S.muted }, hint) : null,
        pending ? h('div', { style: S.muted, role: 'status' }, '正在加载可选能力…') : loadError ? h('div', { style: S.error, role: 'alert' }, loadError) : null,
        selected.length ? h('div', { style: S.chips }, ...selected.map((value, index) => h('span', { key: value, style: { ...S.selected, border: 'none', borderRadius: '10px', padding: '6px 8px', gap: '8px' }, title: available.get(value)?.title ?? value },
          h(CapabilityIcon, { item: available.get(value), kind: kindForLabel(label), size: 28 }),
          ordered && index === 0 ? h('span', { style: S.badge }, primaryHint ?? '主') : null,
          h('span', null, available.get(value)?.name ?? value),
          ordered && index > 0 ? h('button', { type: 'button', style: S.chipX, title: '设为主专家', onClick: () => onChange([value, ...selected.filter((item) => item !== value)]) }, '↑') : null,
          h('button', { type: 'button', style: S.chipX, title: '移除', 'aria-label': `移除${available.get(value)?.name ?? value}`, onClick: () => onChange(selected.filter((item) => item !== value)) }, '×'),
        ))) : null,
        open ? h(CapabilityPicker, { label, groups, selected: selectedKeys, pending, loadError, onRefresh, onClose: () => setOpen(false), onConfirm: (values) => { onChange(values); setOpen(false) } }) : null,
      )
    }

    /** Detailed library settings are only shown inside the management dialog. */
    function resourcesPanel(resources, busy, libraryActions) {
      const libraries = resources.libraries ?? []
      const counts = (entry) => `专家 ${(entry.experts ?? []).length} · 规范 ${(entry.rules ?? []).length} · 技能 ${(entry.skills ?? []).length} · 连接器 ${(entry.connectors ?? []).length}`
      const section = (title, cards, empty) => h('div', { style: { ...S.section, gap: '12px' } },
        h('div', { style: S.sectionHead }, h('strong', null, title), h('span', { style: S.muted }, `${cards.length} 项`),
          title === '共享资源库' && libraryActions ? h(React.Fragment, null, h('span', { style: S.spacer }), button('添加资源库', () => libraryActions.edit(null), { disabled: busy })) : null),
        cards.length ? h('div', { style: S.cards }, cards) : h('div', { style: S.muted }, empty),
      )
      return h('div', { style: { ...S.section, gap: '20px' } },
        section('共享资源库', libraries.map((entry) => h('div', {
          key: entry.name, className: 'wb-item-card', style: { ...S.card, ...S.itemCard },
        },
          h('div', { style: S.bar }, h('strong', null, entry.name), h('span', { style: S.tag }, '资源库'), h('span', { style: S.tag }, entry.trust)),
          h('div', { style: { ...S.muted, ...S.mono } }, entry.trust==='system'?'随产品提供的共享资源库':entry.path),
          entry.repo || entry.git?.remote ? h('div', { style: { ...S.muted, ...S.mono }, title: entry.repo ?? entry.git.remote }, entry.repo ?? entry.git.remote) : null,
          entry.repo ? h('div', { style: S.muted }, `同步：${entry.sync?.startup ? '启动时' : ''}${entry.sync?.startup && entry.sync?.daily ? ' · ' : ''}${entry.sync?.daily ? `每天 ${entry.sync.time ?? '09:00'}（${entry.syncTimezone ?? '本机时间'}）` : ''}${!entry.sync?.startup && !entry.sync?.daily ? '手动' : ''}`) : null,
          entry.repo ? (entry.syncStatus?.running ? h('div', { role: 'status', style: S.muted }, '正在同步资源库…') : entry.syncStatus?.error ? h('div', { role: 'alert', style: S.error }, entry.syncStatus.error) : entry.syncStatus?.lastSuccess ? h('div', { style: S.muted }, `上次同步：${new Date(entry.syncStatus.lastSuccess).toLocaleString()} · ${entry.syncStatus.message ?? ''}`) : null) : null,
          entry.isCheckout || entry.git?.isCheckout ? h('div', { style: S.muted }, entry.ref === undefined ? '跟随本机检出' : `ref ${entry.ref}`) : null,
          entry.exists && entry.headRef ? h('div', { style: { ...S.muted, ...S.mono } }, `${entry.headRef} @ ${entry.revision ?? '?'}`) : null,
          entry.exists ? h('div', { style: S.muted }, counts(entry)) : h('div', { style: S.error }, entry.ref ? '该固定版本检出不存在，请先维护相应版本' : '尚未检出资源库，配置仓库地址后点击立即同步', h('div', { style: S.mono }, entry.command ?? '')),
          entry.exists && !entry.isCheckout ? h('div', { style: S.muted }, '非 git 检出') : null,
          libraryActions ? h('div', { style: { ...S.bar, marginTop: 'auto' } },
            button('编辑配置', () => libraryActions.edit(entry), { disabled: busy || entry.syncStatus?.running }),
            entry.repo ? button(entry.syncStatus?.running ? '同步中…' : '立即同步', () => libraryActions.sync(entry), { disabled: busy || entry.syncStatus?.running }) : null,
            button('删除资源库', () => libraryActions.remove(entry), { disabled: busy || entry.syncStatus?.running, color: '#c0392b' }),
          ) : null,
        )), '按需添加 Git 资源库。未配置时，可直接使用和新建本地能力。'),
      )
    }


    function errorBox(state) {      if (state.error === null || state.error === undefined) return null
      return h('div', { style: S.error }, `✗ ${state.error}`)
    }

    function metricsView(result) {
      if (result === null || result === undefined) return null
      const rows = []
      if (result.effectiveSkills !== undefined) rows.push(`实际装配技能：${result.effectiveSkills.join(', ') || '（无）'}`)
      if (result.effectiveConnectors !== undefined) rows.push(`实际连接器：${result.effectiveConnectors.map((server) => `${server.name}: ${server.transport}`).join('；') || '（无）'}`)
      if (result.expertsInline !== undefined) rows.push(`常驻专家：${result.expertsInline.join(', ') || '（无）'}`)
      if (Array.isArray(result.expertsOnDemand) && result.expertsOnDemand.length > 0) {
        rows.push(`按需专家：${result.expertsOnDemand.map((entry) => `${entry.expert} → ${entry.skill}`).join(', ')}`)
      }
      if (result.personaBytes !== undefined) {
        rows.push(`persona：${result.personaBytes} 字节${result.personaOverBudget === true ? '（超过 32 KB 建议预算）' : ''}`)
      }
      for (const section of result.sections ?? []) rows.push(`　- ${section.title}：${section.bytes} 字节`)
      if (result.rows !== undefined) rows.push(`组合行数：${result.rows}`)
      if (result.validated !== undefined) rows.push(`挂载校验：${result.validated === true ? '通过' : '未通过'}`)
      if (result.error !== undefined) rows.push(`错误：${result.error}`)
      if (result.connectorChecks?.length === 0) rows.push('当前项目没有需要检查的连接器服务。')
      if (rows.length === 0 && !result.connectorChecks?.length) return null
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        ...rows.map((row, index) => h('div', { key: index }, row)),
        ...(result.connectorChecks??[]).map(check=>h('div',{key:check.name,'aria-label':`连接器检查 ${check.name}`,style:check.status==='error'?S.error:check.status==='connected'?S.ok:S.muted},`${check.status==='error'?'✗':check.status==='connected'?'✓':'·'} ${check.name}：${check.message}`)))
    }

    /** One capability kind's display order and Chinese label. */
    const CAPABILITY_GROUPS = [
      { kind: 'expert', label: '专家' },
      { kind: 'skill', label: '技能' },
      { kind: 'rule', label: '规范' },
      { kind: 'connector', label: '连接器' },
    ]

    /** A short, stable form of a content id. */
    const sourceName = value => String(value??'').replace(/workbuddy/gi,'本地扩展')
    const shortHash = (hash) => (typeof hash === 'string' ? hash.slice(0, 8) : '?')

    /**
     * The team capability page: every configured library, everything it
     * publishes, what depends on each capability, and an editor that turns a
     * change into a pull request.
     *
     * The page never commits to the branch a checkout has out — the Host creates
     * a branch, pushes it, and returns the checkout where it was.
     */
    function CapabilitySection({settingsOnly=false,projectMode=false}={}) {
      const [libraries, setLibraries] = useState([])
      const [projects, setProjects] = useState([])
      const [source, setSource] = useState('all')
      const [capabilities, setCapabilities] = useState([])
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [message, setMessage] = useState('')
      const [result, setResult] = useState(null)
      const [libraryDraft, setLibraryDraft] = useState(null)
      const [libraryToRemove, setLibraryToRemove] = useState(null)
      const [activeKind, setActiveKind] = useState('expert')
      const tabsId = React.useId()

      const refresh = useCallback(async () => {
        setLoading(true)
        try {
          const [layout, catalog, projectRows] = await Promise.all([call('options', { cwd: null }), call('capabilities'), call('list')])
          setLibraries(layout.libraries ?? [])
          setProjects(projectRows.filter(project => !project.error))
          setCapabilities(catalog)
          setError(null)
        } catch (problem) {
          setError(problem.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        refresh()
      }, [refresh])

      const editLibrary = (entry) => {
        setError(null); setNotice(null)
        setLibraryDraft(entry ? { name: entry.name, path: entry.trust==='system'?'':entry.configuredPath ?? entry.path, repo: entry.repo ?? entry.git?.remote ?? '', sync: { startup: entry.sync?.startup ?? false, daily: entry.sync?.daily ?? false, time: entry.sync?.time ?? '09:00' }, isNew: false, timezone: entry.syncTimezone } : { name: '', path: '', repo: '', sync: { startup: false, daily: false, time: '09:00' }, isNew: true })
      }
      const syncLibrary = async (entry) => {
        setBusy(true); setError(null); setNotice(null)
        setLibraries((rows) => rows.map((row) => row.name === entry.name ? { ...row, syncStatus: { ...row.syncStatus, running: true, error: undefined } } : row))
        try { const value = await call('syncLibrary', { library: entry.name }); setNotice(`${entry.name}：${value.message}`); await refresh() }
        catch (problem) { await refresh(); setError(problem.message) }
        finally { setBusy(false) }
      }
      const saveLibrary = async (syncNow) => {
        setBusy(true); setError(null)
        try {
          const value = await call('saveLibrary', { config: { name: libraryDraft.name.trim(), path: libraryDraft.path.trim(), repo: libraryDraft.repo.trim(), sync: libraryDraft.sync } })
          setLibraryDraft(null); setNotice('资源库配置已保存'); await refresh()
          if (syncNow) await syncLibrary(value)
        } catch (problem) { setError(problem.message) }
        finally { setBusy(false) }
      }
      const removeLibrary = async () => {
        setBusy(true); setError(null); setNotice(null)
        try {
          await call('removeLibrary', { library: libraryToRemove.name })
          setNotice(`已删除资源库 ${libraryToRemove.name}`); setLibraryToRemove(null); await refresh()
        } catch (problem) { setError(problem.message) }
        finally { setBusy(false) }
      }
      useEffect(() => {
        let active = true
        const poll = async () => {
          if (document.visibilityState === 'hidden') return
          try {
            const rows = await call('libraries')
            if (active) setLibraries(rows)
          } catch { /* Explicit refresh/save reports failures; background polling is quiet. */ }
        }
        const timer = setInterval(poll, 30000)
        return () => { active = false; clearInterval(timer) }
      }, [])

      const openEditor = useCallback(async (capability) => {
        setError(null)
        setNotice(null)
        setResult(null)
        try {
          const read = await call('capability', { key: capability.key, library: capability.library, projectId: capability.projectId, path: capability.relative })
          setEditor({...read,library:capability.library,path:read.path??capability.relative,kind:capability.kind,scope:read.scope??capability.scope??'shared',icon:read.icon??capability.icon??'',iconUrl:read.iconUrl??capability.iconUrl})
          setMessage('')
        } catch (problem) {
          setError(problem.message)
        }
      }, [])

      const openNew = useCallback((kind) => {
        const directory = kind === 'skill' ? 'skills' : kind === 'expert' ? 'experts' : kind === 'rule' ? 'rules' : 'connectors'
        setError(null)
        setNotice(null)
        setResult(null)
        setEditor({
          library: 'personal', scope: 'local',
          path: `${directory}/new-name/${kind === 'skill' ? 'SKILL.md' : kind === 'connector' ? 'mcp.json' : kind === 'expert' ? 'agents/new-name.md' : 'RULE.md'}`,
          content: kind === 'connector' ? JSON.stringify({mcpServers:{'new-name':{type:'streamableHttp',url:'https://example.com/mcp'}}},null,2) : `---\nname: new-name\ndescription: 请填写能力用途\n---\n\n请填写能力内容。`,
          kind,
          isNew: true,
        })
        setMessage('')
      }, [])

      const submit = useCallback(async () => {
        if (editor === null) return
        setBusy(true)
        setError(null)
        setNotice(null)
        setResult(null)
        try {
          const value = await call(editor.scope === 'shared' ? 'contribute' : 'saveCapability', {
            library: editor.library, projectId: editor.projectId, create: editor.isNew === true,
            changes: [{ path: editor.path, content: editor.content, ...(editor.iconDirty ? { icon: editor.icon } : {}) }],
            ...(message.trim() === '' ? {} : { message: message.trim() }),
          })
          setResult(value)
          setNotice(editor.scope === 'shared' ? `已推送分支 ${value.branch}` : '能力已保存，可在项目中选择使用')
          setEditor(null)
          await refresh()
        } catch (problem) {
          setError(problem.message)
        } finally {
          setBusy(false)
        }
      }, [editor, message, refresh])

      const needle = query.trim().toLowerCase()
      const visible = capabilities.filter(entry => (source === 'all' || (entry.scope ?? 'shared') === source) && (!needle || `${entry.key} ${entry.displayName ?? ''} ${entry.description ?? ''} ${entry.sourceLabel ?? entry.library ?? ''}`.toLowerCase().includes(needle)))

      const groups = CAPABILITY_GROUPS.map((group) => ({
        ...group,
        items: visible.filter((entry) => entry.kind === group.kind),
      }))

      const catalog = loading && capabilities.length === 0
        ? h('div', { style: S.muted }, '载入中…')
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              ...groups.filter(group => group.kind === activeKind).map((group) =>
                h('div', { key: group.kind, id: `${tabsId}-panel-${group.kind}`, role: 'tabpanel', 'aria-labelledby': `${tabsId}-tab-${group.kind}`, tabIndex: 0, style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
                  h('div', { style: S.sectionHead },
                    h('strong', null, capabilityLabel(group.label)),
                    h('span', { style: S.muted }, `${group.items.length} 项`),
                    h('span', { style: S.spacer }),
                    button(`新建${group.label}`, () => openNew(group.kind), { disabled: busy }),
                  ),
                  h('div', { className:'wb-capability-cards', style: {...S.cards,gridTemplateColumns:'repeat(auto-fill, minmax(min(240px, 100%), 1fr))'} }, ...group.items.map((entry) =>
                    h('div', {
                      key: entry.key,
                      ...cardProps(`${entry.writable === false ? '查看' : '编辑'}${group.label} ${entry.name}`, () => openEditor(entry), busy),
                    },
                      h('div', { style: { ...S.bar, flexWrap: 'nowrap', alignItems: 'flex-start' } },
                        h(CapabilityIcon, { item: entry, kind: entry.kind, size: 52 }),
                        h('div', { style: { ...S.section, minWidth: 0, flex: 1 } },
                          h('strong', { style: { fontSize: '16px', lineHeight: 1.4 } }, entry.displayName ?? entry.name),
                          h('div', { style: S.chips }, h('span', { style: S.tag }, capabilityLabel(group.label)), h('span', { style: S.tag }, sourceName(entry.sourceLabel ?? `共享 · ${entry.library}`))),
                        ),
                      ),
                      h('div', { className: 'wb-description' }, entry.description || '为项目添加可复用的能力'),
                      h('div', { style: S.muted, title: '引用它的定义' },
                        (entry.refs ?? []).length === 0 ? '未被引用' : `被 ${entry.refs.map((ref) => `${ref.kind} ${ref.id}`).join('、')} 引用`),
                      h('div', { style: { ...S.bar, marginTop: 'auto' } }, h('span', { style: { ...S.muted, fontSize: '11px' }, title: `${entry.relative} · ${entry.hash ?? ''}` }, entry.hash ? `${entry.name} · ${shortHash(entry.hash)}` : entry.name), h('span', { style: S.spacer }), h('span', { style: S.cardAction }, entry.writable === false ? '查看 →' : '编辑 →')),
                    ),
                  )),
                  group.items.length === 0 ? h('div', { style: S.muted }, needle ? '没有匹配的能力' : '暂无能力') : null,
                ),
              ),
            )

      const editorView = editor === null ? null : h(Modal, {
        title: editor.isNew === true ? '新建能力' : `${editor.readOnly ? '查看' : '编辑'} ${editor.path}`, busy,
        onClose: () => setEditor(null),
        footer: h('div', { style: S.bar }, h('span', { style: { ...S.muted, flex: 1 } }, editor.readOnly ? '此能力来自已安装的本地来源' : editor.scope === 'shared' ? '提交至共享资源库' : '保存在本机，无需 Git 资源库'),
          button('取消', () => setEditor(null), { disabled: busy }),
          editor.readOnly ? null : button(busy ? '保存中…' : editor.scope === 'shared' ? '提交为 PR' : '保存能力', submit, { ...S.primary, disabled: busy })),
      },
        errorBox({ error }),
        h('div', { className: 'wb-form-grid', style: S.grid },
          ...field('保存到', h('select', {
            style: S.input, 'aria-label': '能力保存位置',
            value: editor.scope === 'project' ? `project:${editor.projectId}` : editor.scope === 'shared' ? `shared:${editor.library}` : editor.library,
            disabled: busy || editor.isNew !== true,
            onChange: (event) => {
              const [destination, name] = event.target.value.split(':')
              setEditor({ ...editor, scope: destination === 'project' ? 'project' : destination === 'shared' ? 'shared' : 'local', library: destination === 'project' ? 'project' : destination === 'shared' ? name : 'personal', projectId: destination === 'project' ? name : undefined })
            },
          }, h('option', { value: 'personal' }, '本地能力'),
            editor.scope === 'local' && editor.library !== 'personal' ? h('option', {value:editor.library}, `本地 · ${sourceName(editor.library)}`) : null,
            ...projects.map(project => h('option', {key:project.id,value:`project:${project.id}`}, `项目 · ${project.name??project.id}`)),
            ...libraries.map(entry => h('option', {key:entry.name,value:`shared:${entry.name}`}, `共享 · ${entry.name}`)))),
          ...field('文件路径（相对）', h('input', {
            style: { ...S.input, ...S.mono },
            value: editor.path,
            disabled: busy || editor.isNew !== true,
            placeholder: 'experts/legal/agents/legal.md',
            onChange: (event) => setEditor({ ...editor, path: event.target.value }),
          })),
          editor.files?.length ? field('包内文件', h('select',{style:S.input,value:editor.selected,disabled:busy,onChange:async(event)=>{
            try {const read=await call('capability',{key:editor.key,library:editor.library,projectId:editor.projectId,path:editor.package,file:event.target.value});setEditor({...editor,...read,iconDirty:false})}catch(problem){setError(problem.message)}
          }},...editor.files.filter(file=>/\.(?:md|json|ya?ml|txt|js|py|sh)$/.test(file)).map(file=>h('option',{key:file,value:file},file)))) : null,
          ...field('图标', h(IconEditor, { editor, busy: busy || editor.readOnly, onChange: (values) => setEditor((current) => ({ ...current, ...values })) })),
          ...(editor.scope === 'shared' ? field('提交信息', h('input', {
            style: S.input,
            value: message,
            disabled: busy,
            placeholder: '留空则按改动路径自动生成',
            onChange: (event) => setMessage(event.target.value),
          })) : []),
        ),
        h('textarea', {
          'aria-label': '能力内容', style: { ...S.input, ...S.mono, minHeight: '260px' },
          value: editor.content,
          disabled: busy, readOnly: editor.readOnly,
          onChange: (event) => setEditor({ ...editor, content: event.target.value }),
        }),
        h('div', { style: { ...S.muted, fontSize: '12px' } }, editor.readOnly ? '可查看包内文本；修改请在原来源中完成。' : editor.scope === 'shared' ? '提交会新建分支并推送，评审通过后供共享使用。' : '保存后可直接用于项目；已锁定的项目需显式升级能力。'),
      )

      const libraryView = libraryDraft === null ? null : h(Modal, {
        title: libraryDraft.isNew ? '添加资源库' : `编辑资源库 ${libraryDraft.name}`, busy,
        onClose: () => setLibraryDraft(null), footer: h('div', { style: S.bar }, h('span', { style: S.spacer }),
          button('取消', () => setLibraryDraft(null), { disabled: busy }),
          button('保存配置', () => saveLibrary(false), { disabled: busy }),
          libraryDraft.repo.trim() ? button(busy ? '处理中…' : '保存并同步', () => saveLibrary(true), { ...S.primary, disabled: busy }) : null),
      }, errorBox({ error }),
        h('div', { className: 'wb-form-grid', style: S.grid },
          ...field('资源库名称 *', h('input', { style: S.input, 'aria-label': '资源库名称', value: libraryDraft.name, disabled: busy || !libraryDraft.isNew, placeholder: 'team', onChange: (event) => setLibraryDraft({ ...libraryDraft, name: event.target.value }) })),
          ...field('Git 仓库地址', h('input', { style: { ...S.input, ...S.mono }, 'aria-label': 'Git 仓库地址', value: libraryDraft.repo, disabled: busy, placeholder: 'https://example.com/team/capabilities.git 或 git@host:team/repo.git', onChange: (event) => setLibraryDraft({ ...libraryDraft, repo: event.target.value }) })),
          ...field('本机检出目录', h('input', { style: { ...S.input, ...S.mono }, 'aria-label': '本机检出目录', value: libraryDraft.path, disabled: busy, placeholder: '留空使用 DSH libraries 下的同名目录', onChange: (event) => setLibraryDraft({ ...libraryDraft, path: event.target.value }) })),
          ...(libraryDraft.repo.trim() ? field('同步时机', h('div', { style: S.section },
            h('label', { style: S.bar }, h('input', { type: 'checkbox', checked: libraryDraft.sync.startup, disabled: busy, onChange: (event) => setLibraryDraft({ ...libraryDraft, sync: { ...libraryDraft.sync, startup: event.target.checked } }) }), '启动时同步'),
            h('label', { style: S.bar }, h('input', { type: 'checkbox', checked: libraryDraft.sync.daily, disabled: busy, onChange: (event) => setLibraryDraft({ ...libraryDraft, sync: { ...libraryDraft.sync, daily: event.target.checked } }) }), '每天同步'),
            libraryDraft.sync.daily ? h('label', { style: S.bar }, '每日时间', h('input', { type: 'time', style: { ...S.input, width: 'auto' }, 'aria-label': '每日同步时间', value: libraryDraft.sync.time, disabled: busy, onChange: (event) => setLibraryDraft({ ...libraryDraft, sync: { ...libraryDraft.sync, time: event.target.value } }) }), h('span', { style: S.muted }, libraryDraft.timezone ?? '本机时间')) : null,
            !libraryDraft.sync.startup && !libraryDraft.sync.daily ? h('span', { style: S.muted }, '仅手动同步') : null,
          )) : []),
        ),
        libraryDraft.repo.trim() ? h('div', { style: S.muted }, '自动同步在 DSH 运行期间执行；错过每日时间会在启动后补一次。仓库认证使用本机 Git 凭据或 SSH 密钥。已有检出跟随当前分支，仅快进更新。同步后可在能力库查看能力，在工作流模板中选择资源库模板；已发布版本和运行保持固定。') : null,
      )
      const removeLibraryView = libraryToRemove === null ? null : h(Modal, {
        title: `删除资源库 ${libraryToRemove.name}`, busy, onClose: () => setLibraryToRemove(null),
        footer: h('div', { style: S.bar }, h('span', { style: S.spacer }),
          button('取消', () => setLibraryToRemove(null), { disabled: busy }),
          button(busy ? '删除中…' : '确认删除', removeLibrary, { disabled: busy, background: '#c0392b', color: '#fff', borderColor: 'transparent' })),
      }, errorBox({ error }),
        h('div', null, '删除后，该资源库的能力和模板将从可选列表移除，并停止自动同步。'),
        h('div', { style: S.muted }, '本地仓库文件和已锁定的项目能力版本会保留。'),
      )

      if(settingsOnly)return h('div',{className:'wb-root',style:S.root},
        h('div',{style:S.bar},h('strong',null,'资源库设置'),h('span',{style:S.spacer}),button('刷新',refresh,{disabled:busy||loading})),
        h('p',{style:S.muted},'共享资源库统一提供专家、技能、规范、连接器和工作流模板。配置 Git 地址后可手动或定时同步。'),
        errorBox({error}),notice?h('div',{style:S.ok},notice):null,
        resourcesPanel({libraries},busy,{edit:editLibrary,sync:syncLibrary,remove:entry=>{setError(null);setLibraryToRemove(entry)}}),
        libraryView,removeLibraryView,
      )
      return h('div', { className: 'wb-root', style: projectMode ? {...S.root,boxSizing:'border-box',width:'100%',maxWidth:1400,margin:'0 auto',padding:'28px 30px 40px',gap:18,fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',lineHeight:1.6,color:'#223448'} : S.root },
        projectMode ? h('div', { className:'wb-capability-heading', style:{...S.bar,justifyContent:'space-between',gap:10,marginBottom:6} },
          h('div',null,
            h('div',{style:{fontSize:11,letterSpacing:'1.6px',color:'#087e8b',fontWeight:650}},'PROJECT MODE'),
            h('h1',{style:{margin:0,fontSize:23,letterSpacing:'-0.4px',fontWeight:700}},'能力库'),
            h('p',{style:{margin:'6px 0 0',color:'#748396'}},'统一管理本地、项目与共享能力'),
          ),
          button('刷新',refresh,{disabled:busy||loading,border:'1px solid #d9e1e9',borderRadius:7,padding:'7px 14px',background:'#fff',color:'#304659'}),
        ) : h('div', { style: S.bar },
          h('strong', null, '能力库'),
          h('span', { style: S.muted }, '统一管理本地、项目与共享能力'),
          h('span', { style: S.spacer }),
          button('刷新', refresh, { disabled: busy || loading }),
        ),
        editor !== null || libraryDraft !== null || libraryToRemove !== null ? null : errorBox({ error }),
        notice === null ? null : h('div', { style: S.ok }, `✓ ${notice}`),
        h('div', { className:'wb-capability-catalog', style: { ...S.section, gap: '12px', minWidth:0 } },
          h('div', { style: S.bar },
            h('strong', null, '能力清单'),
            h('span', { style: S.muted }, `${capabilities.length} 项能力`),
            h('span', { style: S.spacer }),
            h('select', {style:{...S.input,width:'auto'},'aria-label':'能力来源',value:source,onChange:event=>setSource(event.target.value)}, ...[['all','全部来源'],['local','本地'],['project','项目'],['shared','共享']].map(([value,label])=>h('option',{key:value,value},label))),
            h('input', {
              style: { ...S.input, flex: '0 1 200px' },
              value: query,
              placeholder: '搜索名称、描述或资源库', 'aria-label': '搜索能力库',
              onChange: (event) => setQuery(event.target.value),
            }),
          ),
          h('div', { role: 'tablist', 'aria-label': '能力库分类', style: { ...S.bar, borderBottom: LINE, gap: '4px', paddingBottom: '6px' } },
            ...groups.map((group, index) => h('button', {
              key: group.kind, id: `${tabsId}-tab-${group.kind}`, type: 'button', role: 'tab', 'aria-label': group.label,
              'aria-selected': activeKind === group.kind, 'aria-controls': `${tabsId}-panel-${group.kind}`, tabIndex: activeKind === group.kind ? 0 : -1,
              style: { ...S.button, borderColor: 'transparent', background: activeKind === group.kind ? FILL : 'transparent', fontWeight: activeKind === group.kind ? 650 : 400 },
              onClick: () => setActiveKind(group.kind),
              onKeyDown: event => {
                const next = event.key === 'ArrowRight' ? (index + 1) % groups.length : event.key === 'ArrowLeft' ? (index + groups.length - 1) % groups.length : event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : undefined
                if (next === undefined) return
                event.preventDefault(); setActiveKind(groups[next].kind); event.currentTarget.parentElement.children[next].focus()
              },
            }, group.label, h('span', { style: { ...S.tag, marginLeft: '6px' } }, group.items.length)))),
          catalog,
        ),
        editorView,
        libraryView,
        removeLibraryView,
        result === null || result.saved === true ? null : h('div', { style: { ...S.card, gap: '4px' } },
          h('strong', null, '上次操作结果'),
          h('pre', { style: { ...S.pre, ...S.mono } }, renderResultText(result)),
        ),
      )
    }

    /** A readable rendering of whichever action produced the last result. */
    function renderResultText(value) {
      if (value.branch !== undefined) {
        const lines = [
          `library: ${value.library}`,
          `branch: ${value.branch} (base ${value.base})`,
          ...(value.commit === undefined ? [] : [`commit: ${value.commit}`]),
          `files: ${(value.files ?? []).join(', ')}`,
          `pushed: ${value.pushed === true}`,
        ]
        const pull = value.pullRequest ?? {}
        if (pull.created === true) lines.push(`pull request: ${pull.url}`)
        else if (pull.compare !== undefined) lines.push(`打开 PR: ${pull.compare}`)
        else lines.push('没有配置远端，分支只在本地')
        lines.push('', '评审与合并在 GitHub 上完成。')
        return lines.join('\n')
      }
      return JSON.stringify(value, null, 2)
    }

    /** The settings section. */
    function ProjectsSection() {
      const [projects, setProjects] = useState([])
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [draft, setDraft] = useState(null)
      const [projectTemplates, setProjectTemplates] = useState([])
      const [options, setOptions] = useState(null)
      const [optionsPending, setOptionsPending] = useState(false)
      const [optionsError, setOptionsError] = useState(null)
      const templateRequest = useRef(0)
      const [templatePending, setTemplatePending] = useState(false)
      const optionsRequest = useRef(0)
      const globalOptions = useRef(null)
      const [result, setResult] = useState(null)

      const refresh = useCallback(async () => {
        setLoading(true)
        try {
          const [rows, templates] = await Promise.all([call('list'), call('templates')])
          setProjects(rows); setProjectTemplates(templates)
          setError(null)
        } catch (problem) {
          setError(problem.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        refresh()
      }, [refresh])

      // Only the latest directory request may populate the capability pickers.
      const loadOptions = useCallback(async (cwd) => {
        const target = cwd.trim()
        const request = ++optionsRequest.current
        setOptions(globalOptions.current ? { ...globalOptions.current, cwd: target || undefined, exists: false, hasProject: false } : null)
        setOptionsError(null)
        setOptionsPending(true)
        try {
          const value = await call('options', { cwd: target || null })
          if (request === optionsRequest.current) {
            if (!target) globalOptions.current = { ...value, cwd: undefined, exists: false, hasProject: false, document: undefined, gitignore: undefined, rules: [], experts: { ...value.experts, project: [] }, skills: { ...value.skills, project: [] } }
            setOptions(value)
          }
        } catch (problem) {
          if (request === optionsRequest.current) setOptionsError(`${target ? '无法检查工作目录' : '无法加载能力选项'}：${problem.message}`)
        } finally {
          if (request === optionsRequest.current) setOptionsPending(false)
        }
      }, [])

      const openNew = useCallback(() => {
        ++templateRequest.current
        setTemplatePending(false)
        ++optionsRequest.current
        setError(null)
        setOptions(null)
        setOptionsPending(false)
        setOptionsError(null)
        setResult(null)
        setNotice(null)
        setDraft({ mode: 'new', cwd: '', id: '', name: '', description: '', instructions: '', rules: [], experts: [], skills: [], connectors: [] })
        loadOptions('')
      }, [loadOptions])

      const openEdit = useCallback(async (id) => {
        ++templateRequest.current
        setTemplatePending(false)
        setResult(null)
        setNotice(null)
        setError(null)
        try {
          const detail = await call('describe', { id })
          const project = detail.project
          setDraft({
            mode: 'edit',
            cwd: project.cwd,
            id: project.id,
            name: project.name ?? project.id,
            description: project.description ?? '',
            instructions: detail.instructionsContent ?? project.instructions ?? '',
            rules: [...(project.rules ?? [])],
            experts: [...(project.experts ?? [])],
            skills: [...(project.skills ?? [])],
            connectors: [...(project.connectors ?? [])],
          })
          await loadOptions(project.cwd)
        } catch (problem) {
          setError(problem.message)
        }
      }, [loadOptions])

      const closeEditor = useCallback(() => {
        ++templateRequest.current
        setTemplatePending(false)
        ++optionsRequest.current
        setOptionsPending(false)
        setOptionsError(null)
        setDraft(null)
        setOptions(null)
        setResult(null)
      }, [])

      const patch = useCallback((changes) => {
        setDraft((current) => (current === null ? current : { ...current, ...changes }))
      }, [])

      const selectTemplate = useCallback(async (reference) => {
        const request = ++templateRequest.current
        setTemplatePending(false)
        // Custom keeps the user's edits and any already-selected template files.
        if (reference === '') { patch({ selectedTemplate: '' }); return }
        setTemplatePending(true)
        setError(null)
        try {
          const value = await call('templateDraft', { template: reference })
          if (request !== templateRequest.current) return
          const config = value.config
          setDraft((current) => current === null ? current : {
            ...current, template: value.template, selectedTemplate: value.template, templateOptions: value.options, templateCwd: value.cwd,
            name: !current.name.trim() || current.name === current.templateDefaultName ? config.name : current.name,
            templateDefaultName: !current.name.trim() || current.name === current.templateDefaultName ? config.name : undefined,
            description: config.description ?? '', instructions: config.instructions ?? '',
            rules: [...(config.rules ?? [])], experts: [...(config.experts ?? [])], skills: [...(config.skills ?? [])],
            connectors: [...(config.connectors ?? [])],
          })
          setResult(null); setNotice(null)
        } catch (problem) {
          if (request === templateRequest.current) setError(`无法加载模板：${problem.message}`)
        } finally { if (request === templateRequest.current) setTemplatePending(false) }
      }, [patch])

      const configFromDraft = useCallback(() => {
        return {
          id: draft.id.trim() === '' ? undefined : draft.id.trim(),
          name: draft.name.trim(),
          cwd: draft.cwd.trim(),
          description: draft.description.trim() === '' ? undefined : draft.description.trim(),
          instructions: draft.instructions,
          rules: draft.rules,
          experts: draft.experts,
          skills: draft.skills,
          connectors: draft.connectors,
        }
      }, [draft])

      const save = useCallback(async () => {
        if (draft === null) return
        setBusy(true)
        setError(null)
        setNotice(null)
        setResult(null)
        try {
          const config = configFromDraft()
          if (config.name === '') throw new Error('需要项目名称')
          if (config.cwd === '') throw new Error('请填写项目工作目录')
          if (draft.mode === 'new') {
            const checked = await call('options', { cwd: config.cwd })
            setOptions(checked)
            if (!checked.exists) throw new Error('工作目录不存在或不是文件夹，请先创建目录再新建项目')
            if (checked.hasProject) throw new Error('该目录已配置项目，请选择其他目录新建；已有项目可从项目列表进入编辑')
          }
          const value = draft.mode === 'new'
            ? draft.template ? await call('fromTemplate', { template: draft.template, cwd: config.cwd, config }) : await call('create', { config })
            : await call('update', { config })
          setResult(value)
          setNotice(draft.mode === 'new' ? `已创建项目 ${value.id}` : `已保存并重编译 ${value.id}`)
          if (draft.mode === 'new') {
            setDraft((current) => (current === null ? current : { ...current, mode: 'edit', id: value.id, cwd: value.cwd ?? current.cwd, template: undefined, selectedTemplate: undefined, templateOptions: undefined, templateCwd: undefined, templateDefaultName: undefined }))
          }
          await refresh()
          await loadOptions(value.cwd ?? draft.cwd)
        } catch (problem) {
          setError(problem.message)
        } finally {
          setBusy(false)
        }
      }, [draft, configFromDraft, refresh, loadOptions])

      const remove = useCallback(async (id) => {
        setBusy(true)
        setError(null)
        try {
          await call('remove', { id })
          setNotice(`已删除项目 ${id}`)
          if (draft !== null && draft.id === id) closeEditor()
          await refresh()
        } catch (problem) {
          setError(problem.message)
        } finally {
          setBusy(false)
        }
      }, [draft, closeEditor, refresh])

      const projectCards = projects.map((project) =>
        h(
          'div',
          { key: project.id, ...cardProps(`编辑项目 ${project.name ?? project.id}`, () => openEdit(project.id), busy), style: { ...S.card, ...S.itemCard, ...S.cardPick, ...S.projectCard } },
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 } },
            h(CapabilityIcon, { kind: 'project', size: 32 }), h('strong', { style: { fontSize: '15px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: project.name ?? project.id }, project.name ?? project.id),
            h('span', { style: { ...S.tag, whiteSpace: 'nowrap' } }, project.preset?.known === true ? '已编译' : '未编译'),
          ),
          project.description ? h('div', { className: 'wb-description', style: { WebkitLineClamp: 2 } }, project.description) : null,
          h('div', { style: { ...S.muted, ...S.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: `${project.id} · ${project.cwd}` }, project.cwd),
          h('div', { style: { ...S.muted, fontSize: '12px' } },
            `专家 ${(project.experts ?? []).length} · 规范 ${(project.rules ?? []).length} · 技能 ${(project.skills ?? []).length} · 连接器 ${(project.connectors ?? []).length}`),
          h('div', { style: S.cardAction }, '点击编辑'),
        ),
      )

      // Where each pickable value comes from, so a bare project-local name and a
      // `library:name` reference can never be mistaken for one another.
      const optionGroups = (source, pick) => {
        if (options === null) return []
        return source
          .map((entry) => ({ label: entry.label, items: entry.items.map(pick) }))
      }
      const expertGroups = optionGroups(
        [
          { label: '项目', items: options?.experts?.project ?? [] },
          { label: '模板', items: draft?.templateOptions?.experts ?? [] },
          { label: '团队共享', items: options?.experts?.shared ?? [] },
          { label: '本地能力', items: options?.experts?.library ?? [] },
        ],
        (item) => ({value:item.reference,name:item.displayName??item.name,description:item.description,icon:item.icon,iconUrl:item.iconUrl,library:item.library,title:item.path,disabled:item.error}),
      )
      const skillGroups = optionGroups(
        [
          { label: '项目', items: options?.skills?.project ?? [] },
          { label: '模板', items: draft?.templateOptions?.skills ?? [] },
          { label: '本地能力', items: (options?.skills?.local ?? []).filter((item) => !(options?.skills?.project ?? []).some((project) => project.path === item.path)).map((item) => ({ ...item, local: true })) },
          { label: '团队共享', items: options?.skills?.shared ?? [] },
        ],
        (item) => ({value:item.reference,name:item.displayName??item.name,description:item.description,icon:item.icon,iconUrl:item.iconUrl,library:item.library,title:item.path,disabled:item.error}),
      )
      const ruleGroups = optionGroups(
        [
          { label: '项目', items: options?.rules ?? [] },
          { label: '模板', items: draft?.templateOptions?.rules ?? [] },
          { label: '本地能力', items: options?.localRules ?? [] },
          { label: '团队共享', items: options?.sharedRules ?? [] },
        ],
        (item) => ({value:item.reference,name:item.displayName??item.name,description:item.description,icon:item.icon,iconUrl:item.iconUrl,library:item.library,title:item.path,disabled:item.error}),
      )
      const connectorGroups = optionGroups(
        [{label:'项目',items:options?.connectors?.project??[]},{label:'模板',items:draft?.templateOptions?.connectors??[]},{label:'团队共享',items:options?.connectors?.shared??[]},{label:'本地能力',items:options?.connectors?.local??[]}],
        item=>({value:item.reference,name:item.displayName??item.name,description:item.description,icon:item.icon,iconUrl:item.iconUrl,library:item.library,title:item.path,disabled:item.error}),
      )

      const directoryConflict = draft?.mode === 'new' && options?.hasProject === true
      const existingProject = directoryConflict ? projects.find((project) => project.cwd === options.cwd) : null
      const directoryHint = draft?.cwd.trim() === ''
        ? draft.template ? '请填写目标工作目录；模板项目可以自动创建目录。' : '请填写一个已存在、尚未配置项目的工作目录；每个目录只能对应一个项目。'
        : optionsPending ? '正在检查工作目录…'
        : optionsError ?? (options?.exists === false ? draft.template ? '保存模板项目时将创建目标目录。' : '目录不存在或不是文件夹，请先创建目录后再填写。'
        : directoryConflict ? `该目录已有项目${existingProject ? `「${existingProject.name ?? existingProject.id}」` : ''}，请选择其他目录；已有项目可从项目列表进入编辑。`
        : null)
      const directoryBlocked = draft?.mode === 'new' && (draft.cwd.trim() === '' || optionsPending || optionsError !== null || options === null || (!options.exists && !draft.template) || directoryConflict)

      const templates = options?.templates ?? globalOptions.current?.templates ?? projectTemplates
      const editorBusy = busy || templatePending
      const editor = draft === null ? null : h(
        Modal,
        { title: draft.mode === 'new' ? '新建项目' : `编辑 ${draft.id}`, onClose: closeEditor, busy, footer: h('div', { style: S.bar },
          draft.mode === 'new' ? h('span', { style: { ...S.muted, flexBasis: '100%', fontSize: '12px' } }, '切换模板会覆盖当前指令和能力配置，保留工作目录和已填写的名称、ID。') : null, h('span', { style: S.spacer }), button('取消', closeEditor, { disabled: busy }),
          button(busy ? '处理中…' : '保存并编译', save, { ...S.primary, disabled: editorBusy || directoryBlocked }),
          draft.mode === 'edit' ? button('检查连接器', async()=>{setBusy(true);setError(null);setNotice(null);try{const value=await call('checkConnectors',{id:draft.id});setResult(current=>({...current,...value}));setNotice(value.healthy?'已保存项目的连接器检查完成':'已保存项目的连接器检查完成，请处理下方失败项')}catch(problem){setError(problem.message)}finally{setBusy(false)}}, {disabled:busy}) : null,
          draft.mode === 'edit' ? button('删除项目', () => remove(draft.id), { disabled: busy }) : null,
        ) },
        errorBox({ error }),
        notice === null ? null : h('div', { style: S.ok }, `✓ ${notice}`),
        h('div', { className: 'wb-form-grid', style: S.grid },
          ...field('工作目录 *', h('div', { style: S.section },
            h('input', {
              style: { ...S.input, ...S.mono },
              value: draft.cwd,
              placeholder: '/项目工作目录的绝对路径',
              disabled: draft.mode === 'edit' || busy,
              onChange: (event) => {
                patch({ cwd: event.target.value })
                setError(null)
                loadOptions(event.target.value)
              },
            }),
            directoryHint === null ? null : h('div', {
              role: 'status', style: optionsError || options?.exists === false || directoryConflict ? S.error : S.muted,
            }, directoryHint),
          )),
          ...field('项目 ID', h('input', {
            style: { ...S.input, ...S.mono },
            value: draft.id,
            placeholder: '留空则按名称生成',
            disabled: draft.mode === 'edit',
            onChange: (event) => patch({ id: event.target.value }),
          })),
          ...field('名称 *', h('input', { style: S.input, value: draft.name, onChange: (event) => patch({ name: event.target.value, templateDefaultName: undefined }) })),
          ...field('描述', h('input', { style: S.input, value: draft.description, onChange: (event) => patch({ description: event.target.value }) })),
        ),
        h('div', { style: S.section },
          h('div', { style: S.sectionHead },
            h('span', { style: S.label }, '项目指令'),
            h('span', { style: S.muted }, '直接填写项目目标、工作标准和要求，仅作为文本保存'),
            draft.mode === 'new' ? h('select', {
              style: { ...S.input, width: 'auto', maxWidth: '100%', marginLeft: 'auto' }, 'aria-label': '选择模板',
              value: draft.selectedTemplate ?? '', disabled: editorBusy || optionsPending,
              onChange: (event) => selectTemplate(event.target.value),
            }, h('option', { value: '' }, optionsPending ? '正在加载模板…' : '选择模板（自定义）'),
              ...templates.map((template) => h('option', { key: `${template.library}:${template.id}`, value: `${template.library}:${template.id}`, disabled: !!template.error, title: template.error ?? template.description }, `${template.name ?? template.id} · ${template.library}${template.error ? '（不可用）' : ''}`))) : null,
          ),
          h('textarea', {
            style: { ...S.input, minHeight: '140px' },
            value: draft.instructions,
            placeholder: '这个项目要做什么、按什么标准做',
            onChange: (event) => patch({ instructions: event.target.value }),
          }),
        ),
        templatePending ? h('div', { role: 'status', style: S.muted }, '正在填入模板配置…') : null,
        draft.mode === 'new' && !optionsPending && !optionsError && templates.length === 0 ? h('div', { style: S.muted }, '暂无项目模板，可直接填写指令创建项目。') : null,
        h(ListField, {
          label: '规范',
          hint: '硬性约束，编译后常驻 system prompt，不按需加载',
          selected: draft.rules,
          groups: ruleGroups,
          pending: optionsPending, loadError: optionsError, onRefresh: () => loadOptions(draft.cwd),
          onChange: (next) => patch({ rules: next }),
        }),
        h(ListField, {
          label: '专家',
          hint: '第一位为主专家，自动带入它的能力依赖；其余仅为方法论卡（↑ 切换主专家后新建会话）',
          selected: draft.experts,
          groups: expertGroups,
          pending: optionsPending, loadError: optionsError, onRefresh: () => loadOptions(draft.cwd),
          ordered: true,
          primaryHint: '主',
          onChange: (next) => patch({ experts: next }),
        }),
        h(ListField, {
          label: '技能',
          hint: '只有选中的技能会在该项目会话里可见',
          selected: draft.skills,
          groups: skillGroups,
          pending: optionsPending, loadError: optionsError, onRefresh: () => loadOptions(draft.cwd),
          onChange: (next) => patch({ skills: next }),
        }),
        h(ListField, {label:'连接器',hint:'选择完整连接器包，自动带入其服务配置和附带技能',selected:draft.connectors,groups:connectorGroups,
          pending:optionsPending,loadError:optionsError,onRefresh:()=>loadOptions(draft.cwd),onChange:next=>patch({connectors:next})}),
        metricsView(result),
      )

      return h(
        'div',
        { style: S.root },
        h('div', { style: S.bar },
          h('strong', null, '项目'),
          h('span', { style: S.muted }, '把指令、规范、专家、技能与连接器 组织成一个可选的 agent preset'),
          h('span', { style: S.spacer }),
          button('刷新', refresh, { disabled: busy || loading }),
          button('新建项目', openNew, { ...S.primary, disabled: busy }),
        ),
        draft === null ? errorBox({ error }) : null,
        notice === null ? null : h('div', { style: S.ok }, `✓ ${notice}`),
        loading && projects.length === 0 ? h('div', { style: S.muted }, '载入中…') : null,
        projects.length === 0 && !loading ? h('div', { style: S.muted }, '还没有项目。点「新建项目」开始，或在宿主会话里调用 project_create。') : null,
        projectCards.length === 0 ? null : h('div', { style: S.projectCards }, projectCards),
        h('details', {style:S.section}, h('summary', {style:{cursor:'pointer',fontWeight:600}}, `项目模板 · ${projectTemplates.length}`),
          projectTemplates.length ? h('div', {style:{...S.projectCards,marginTop:'12px'}}, ...projectTemplates.map(template=>h('div',{key:`${template.library}:${template.id}`,style:S.card},
            h('strong',null,template.name??template.id),h('span',{style:S.muted},template.description??template.library),
            template.error ? h('div',{style:S.error},template.error) : button('用此模板新建',()=>{openNew();selectTemplate(`${template.library}:${template.id}`)},{disabled:busy}))))
          : h('div',{style:S.muted},'暂无项目模板，仍可直接新建项目。可选模板来自已添加的资源库。')),
        editor,
        h('div', { style: { ...S.muted, fontSize: '12px' } },
          '项目编译成 preset 后，在新会话的 preset 选择器里选中它即生效；已在运行的会话保持启动时的组合。'),
      )
    }

    /**
     * Mount the settings page.
     * @param ctx - the client context.
     */
function DeliveryIcon({ size = 18 }) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
    },
    h("rect", { x: 3, y: 3, width: 6, height: 6, rx: 1.5 }),
    h("rect", { x: 15, y: 15, width: 6, height: 6, rx: 1.5 }),
    h("path", { d: "M9 6h6a3 3 0 0 1 3 3v6M6 9v9h9" }),
  );
}
function DeliveryExecutionSettings() {
  const [saved,setSaved]=useState(null),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{
    let active=true;
    deliveryApi('settings/get').then(value=>{if(active){setSaved(value.autoAllowDangerFullAccess);setEnabled(value.autoAllowDangerFullAccess)}}).catch(problem=>{if(active)setError(problem.message)});
    return()=>{active=false};
  },[]);
  const save=async()=>{
    setBusy(true);setError('');setNotice('');
    try {
      const value=await deliveryApi('settings/save',{autoAllowDangerFullAccess:enabled});
      setSaved(value.autoAllowDangerFullAccess);setEnabled(value.autoAllowDangerFullAccess);
      setNotice(value.autoAllowDangerFullAccess?'已开启：当前等待及后续的完全访问请求将自动允许。':'已关闭：后续完全访问请求需要逐次确认。');
    } catch(problem){setError(problem.message)} finally {setBusy(false)}
  };
  return h('section',{'aria-label':'节点执行权限',style:{...S.card,background:'#fff',padding:20,gap:14,marginBottom:24}},
    h('div',{style:S.bar},h('strong',null,'节点执行权限'),h('span',{style:{...S.tag,color:saved?'#a15a13':'#526576'}},saved===null?'读取中…':saved?'自动允许已开启':'逐次确认')),
    h('label',{style:{...S.bar,alignItems:'flex-start',fontWeight:600}},h('input',{type:'checkbox',checked:enabled,disabled:saved===null||busy,onChange:event=>{setEnabled(event.target.checked);setNotice('')}}),'自动允许 danger-full-access'),
    h('div',{style:S.muted},'开启后，本机项目模式所有节点的此类权限请求会自动允许，包括当前正在等待的请求，无需每次选择。工具将以当前登录用户的权限在沙箱外执行，可访问工作树外的文件和网络。'),
    h('div',{style:S.muted},'此设置保存在本机，不随共享模板同步。其他审批仍逐次确认；DSH 的“从不允许”策略仍然优先。关闭后不会中断已经获准的调用。'),
    error?h('div',{role:'alert',style:S.error},error):null,
    notice?h('div',{role:'status',style:S.ok},notice):null,
    h('div',{style:S.bar},button(busy?'保存中…':'保存执行设置',save,{disabled:saved===null||busy||enabled===saved,background:'#087e8b',color:'#fff',borderColor:'transparent'})),
  );
}
function DeliveryPanel({openNativeSession}) {
  const [page, setPage] = useState("projects"),
    [navigationError, setNavigationError] = useState("");
  const frame = useRef(null),
    pending = useRef(null);
  useEffect(() => {
    const receive = (event) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        !["delivery-navigation-ready","delivery-open-native-session"].includes(event.data?.type)
      )
        return;
      if(event.data.type==='delivery-open-native-session') {
        openNativeSession(event.data).catch(error=>setNavigationError(error.message));
        return;
      }
      if(!pending.current)return;
      const item = pending.current;
      pending.current = null;
      clearTimeout(item.timer);
      event.data.error
        ? setNavigationError(event.data.error)
        : setPage(item.page);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      if (pending.current) clearTimeout(pending.current.timer);
    };
  }, [openNativeSession]);
  const navigate = (id) => {
    if (id === page || pending.current) return;
    setNavigationError("");
    if (page !== "templates" || !frame.current) {
      setPage(id);
      return;
    }
    const timer = setTimeout(() => {
      pending.current = null;
      setNavigationError("画布未响应，请保存草稿后重试。");
    }, 15000);
    pending.current = { page: id, timer };
    frame.current.contentWindow.postMessage(
      { type: "delivery-prepare-navigation" },
      location.origin,
    );
  };
  const tabs = [
    ["projects", "项目"],
    ["templates", "工作流模板"],
    ["capabilities", "能力库"],
    ["runs", "运行记录"],
  ];
  return h(
    "div",
    {
      style: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#f5f7fa",
        color: "#172637",
        minWidth: 0,
      },
    },
    h(
      "header",
      {
        style: {
          padding: "20px 28px 0",
          background: "#fff",
          borderBottom: "1px solid #e3e8ef",
        },
      },
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
          },
        },
        h(DeliveryIcon, { size: 24 }),
        h("strong", { style: { fontSize: 20 } }, "项目模式"),
        h(
          "span",
          {
            style: {
              fontSize: 11,
              color: "#687787",
              border: "1px solid #dfe6ef",
              borderRadius: 5,
              padding: "2px 7px",
            },
          },
          "PREVIEW 0.4",
        ),
        h("span",{style:{flex:1}}),
        h("button",{type:"button",title:"设置",'aria-label':"项目模式设置",onClick:()=>navigate("settings"),style:{display:"grid",placeItems:"center",width:36,height:36,border:"1px solid #dfe6ef",borderRadius:8,background:page==="settings"?"#e8f3f3":"#fff",color:"#42606d",cursor:"pointer"}},
          h("svg",{width:20,height:20,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.6,'aria-hidden':true},h("path",{d:"M9.5 3h5l.7 2.5 2 .9 2.4-.7 2.5 4.3-1.8 1.8v2.3l1.8 1.7-2.5 4.3-2.4-.7-2 .9-.7 2.5h-5l-.7-2.5-2-.9-2.4.7L1.9 16l1.8-1.8v-2.3L1.9 10l2.5-4.3 2.4.7 2-.9z",transform:"translate(0 -1) scale(1 .96)"}),h("circle",{cx:12,cy:12,r:3.2}))),
      ),
      h(
        "nav",
        { style: { display: "flex", gap: 28 } },
        tabs.map(([id, label]) =>
          h(
            "button",
            {
              key: id,
              onClick: () => navigate(id),
              style: {
                background: "none",
                border: 0,
                borderBottom:
                  page === id ? "2px solid #087e8b" : "2px solid transparent",
                color: page === id ? "#087e8b" : "#647184",
                fontWeight: page === id ? 650 : 450,
                padding: "0 0 13px",
                cursor: "pointer",
                fontSize: 14,
              },
            },
            label,
          ),
        ),
      ),
    ),
    navigationError
      ? h(
          "div",
          { style: { padding: "8px 28px", color: "#ad3434" } },
          navigationError,
        )
      : null,
    page === "capabilities"
      ? h(
          "div",
          { style: { overflow: "auto", flex: 1 } },
          h(CapabilitySection, { projectMode: true }),
        )
      : page === "settings" ? h("div",{style:{overflow:"auto",padding:24,flex:1}},h(DeliveryExecutionSettings),h(CapabilitySection,{settingsOnly:true}))
      : h("iframe", {
          ref: frame,
          key: page,
          title: "项目模式 · " + tabs.find((x) => x[0] === page)?.[1],
          src: "/api/workbuddy-delivery?document=app&page=" + page,
          style: { border: 0, width: "100%", flex: 1, minHeight: 0 },
        }),
  );
}
const deliveryNativeSessions=new Map();
const deliveryNativeSubscribers=new Set();
async function deliveryApi(action,payload={}) {
  const response=await fetch('/api/workbuddy-delivery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'无法读取节点会话');
  return data;
}
function mountDeliveryClient(ctx) {
  const block=info=>{
    deliveryNativeSessions.set(info.sessionId,info);
    ctx.conversation?.blocks.set(info.sessionId,{reason:'此工作流节点由项目模式管理。请点击“返回项目节点”继续对话、恢复执行或验收。'});
  };
  let disposed=false,refreshing=false;
  const refresh=async()=>{
    if(refreshing||disposed)return;
    refreshing=true;
    try {const entries=await deliveryApi('nodes/native-sessions');if(!disposed){for(const info of entries)block(info);for(const notify of deliveryNativeSubscribers)notify();}}
    catch {} finally {refreshing=false;}
  };
  if(ctx.conversation){void refresh();const timer=setInterval(refresh,5000);ctx.on('dispose',()=>{disposed=true;clearInterval(timer);for(const id of deliveryNativeSessions.keys())ctx.conversation.blocks.set(id,undefined);deliveryNativeSessions.clear();});}
  const openNativeSession=async({requestId,nodeId,attempt})=>{
    const detail=await deliveryApi('runs/node',{requestId,nodeId});
    const info=attempt?detail.attempts.find(item=>item.attempt===attempt)?.nativeSession:detail.nativeSession;
    if(!info?.ready)throw new Error('节点原生会话尚未就绪，请稍后重试。');
    if(!ctx.uiWorkspace)throw new Error('当前 DSH 未提供原生工作区导航，请使用 0.2.1-rc.3 Web。');
    sessionStorage.setItem('delivery:return-node',JSON.stringify({requestId,nodeId}));
    block(info);
    if(info.legacySidebar)await deliveryApi('nodes/native-session/open',{nativeSessionId:info.sessionId});
    await ctx.sessions.refresh();
    ctx.uiWorkspace.openSession(info.address??info.sessionId);
  };
  function NativeNodeReturn({sessionId}) {
    const [,update]=useState(0);
    useEffect(()=>{const notify=()=>update(value=>value+1);deliveryNativeSubscribers.add(notify);return()=>deliveryNativeSubscribers.delete(notify);},[]);
    const info=deliveryNativeSessions.get(String(sessionId));
    const returnToNode=async()=>{
      sessionStorage.setItem('delivery:return-node',JSON.stringify({requestId:info.requestId,nodeId:info.nodeId}));
      try {
        if(info.legacySidebar) {
          const result=await deliveryApi('nodes/native-session/close',{nativeSessionId:info.sessionId});
          if(result.archived)await ctx.uiWorkspace.archiveSession(info.sessionId);
        }
      } finally {ctx.layout.selectPanel('workbuddy-delivery');}
    };
    return info?h('button',{type:'button','data-delivery-node':info.nodeId,title:'返回项目模式：'+info.title,onClick:returnToNode,style:{border:'1px solid #7199a0',borderRadius:6,padding:'5px 10px',background:'transparent',color:'inherit',cursor:'pointer'}},info.pendingApprovalCount?'返回项目节点 · 待权限确认':'返回项目节点'):null;
  }
  ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'delivery-node-return',order:10},NativeNodeReturn));
  const Panel=()=>h(DeliveryPanel,{openNativeSession});
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "workbuddy-delivery",
        order: 25,
        label: "项目模式",
      },
      DeliveryIcon,
    ),
  );
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      { name: "main", key: "workbuddy-delivery" },
      Panel,
    ),
  );
}

    function apply(ctx) {
      mountDeliveryClient(ctx)
      ensureStyles()
      ctx.slots.inject('settings.section', () => {
        const disposers = [
          ctx.slots.register(
            { name: 'settings.section', id: 'workbuddy-project', order: 25, label: '会话项目' },
            ProjectsSection,
          ),
          ctx.slots.register(
            { name: 'settings.section', id: 'workbuddy-project-capabilities', order: 26, label: '能力库' },
            CapabilitySection,
          ),
        ]
        return () => {
          for (const dispose of disposers) if (typeof dispose === 'function') dispose()
        }
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'uiWorkspace', 'conversation', 'layout', 'sessions']
    return module.exports
  },
})
