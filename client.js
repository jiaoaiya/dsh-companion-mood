/* DSH Web client bundle: the module id must match package.json name. */
;(function () {
  const scriptPath = document.currentScript?.src ? new URL(document.currentScript.src).pathname : ''
  const appBase = /^(.*?)\/plugins\//.exec(scriptPath)?.[1] || ''
window.__ModuleLoader__.load({
  id: 'dsh-companion-mood',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const path = (value) => appBase + value
    const fields = [
      ['assessmentIdleMinutes', '停聊后评估等待', '分钟', 1, 60],
      ['reassessMinutes', '暂不联系后再次评估', '分钟', 30, 1440],
      ['checkMinutes', '检查频率', '分钟', 1, 1440],
      ['minIdleMinutes', '主动联系前最低沉默', '分钟', 1, 10080],
      ['cooldownMinutes', '两次主动联系冷却', '分钟', 1, 10080],
      ['maxPerDay', '每天最多联系', '次', 0, 24],
      ['quietStartHour', '静默开始', '时', 0, 23],
      ['quietEndHour', '静默结束', '时', 0, 23],
    ]
    const css = [
      '.companion-panel{max-width:900px;color:var(--dsw-alias-label-primary,inherit);font-size:13px}',
      '.companion-tabs{display:flex;gap:20px;border-bottom:1px solid var(--dsw-alias-border-l1,#6666);margin-bottom:18px}',
      '.companion-tab{border:0;border-bottom:2px solid transparent;background:none;color:inherit;padding:10px 3px;cursor:pointer}',
      '.companion-tab.active{border-bottom-color:var(--dsw-alias-brand-primary,#859bff);font-weight:700}',
      '.companion-box{border:1px solid var(--dsw-alias-border-l1,#6666);background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));border-radius:12px;padding:17px;margin:12px 0}',
      '.companion-box h3{margin:0 0 10px;font-size:15px}',
      '.companion-note{opacity:.72;line-height:1.5;margin:5px 0 14px}',
      '.companion-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}',
      '.companion-label{display:flex;flex-direction:column;gap:5px;font-weight:600}',
      '.companion-input{width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l1,#7777);border-radius:7px;background:var(--dsw-alias-bg-base,#20232e);color:inherit;font:inherit}',
      '.companion-input[type=checkbox]{width:auto;accent-color:#859bff}',
      '.companion-input:is(select){background:#20242d;color:#f7f8fb;color-scheme:dark}',
      '.companion-input option{background-color:#20242d;color:#f7f8fb}',
      '.companion-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:15px 0}',
      '.companion-button{border:1px solid var(--dsw-alias-border-l1,#7777);border-radius:7px;padding:8px 13px;cursor:pointer;background:var(--dsw-alias-bg-layer-2,#4446);color:inherit;font:inherit}',
      '.companion-button.primary{background:var(--dsw-alias-button-primary-fill,#3566d8);border-color:var(--dsw-alias-button-primary-fill,#3566d8);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}',
      '.companion-button.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#2856c4);border-color:var(--dsw-alias-button-primary-hover,#2856c4)}',
      '.companion-button:disabled{opacity:.65;cursor:not-allowed}',
      '.companion-status{min-height:18px;opacity:.8}',
      '.companion-status.error{color:#f77}',
      '.companion-packs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}',
      '.companion-pack{overflow:hidden;border:1px solid var(--dsw-alias-border-l1,#7777);border-radius:11px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08))}',
      '.companion-cover{width:100%;height:165px;object-fit:cover;background:var(--dsw-alias-bg-layer-2,#4446);cursor:pointer}',
      '.companion-pack-body{padding:13px;background:rgba(20,24,32,.94);color:#f7f8fb}',
      '.companion-pack-body .companion-button:not(.primary){background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22);color:#f7f8fb}',
      '.companion-pack-body .companion-tag{background:rgba(255,255,255,.12)}',
      '.companion-import-help{line-height:1.6;opacity:.8}',
      '.companion-pack-body h3{margin:0 0 5px;font-size:15px}',
      '.companion-pack-body p{margin:4px 0;opacity:.72;line-height:1.4}',
      '.companion-tags{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}',
      '.companion-tag{border-radius:12px;background:var(--dsw-alias-bg-layer-2,#7773);padding:3px 8px;font-size:11px}',
      '.companion-preview{position:fixed;inset:0;background:#090c15d9;z-index:1000;display:grid;place-items:center;padding:20px}',
      '.companion-preview-inner{width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--dsw-alias-bg-base,#20232e);padding:18px;border-radius:12px}',
      '.companion-preview-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}',
      '.companion-preview-grid img{width:100%;aspect-ratio:1;object-fit:contain}',
      '@media(max-width:620px){.companion-grid,.companion-packs{grid-template-columns:1fr}.companion-preview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    ].join('\n')
    async function api(url, body) {
      const response = await fetch(path(url), body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error(data.error || '请求失败')
      return data
    }
    function fuzzyScore(pack, query) {
      const q = String(query || '').trim().toLocaleLowerCase().replace(/\s+/g, '')
      if (!q) return 1
      const fields = [pack.name, pack.description, pack.maintainer || pack.author, ...(pack.keywords || [])].map(x => String(x || '').toLocaleLowerCase().replace(/\s+/g, ''))
      if (fields.some(x => x.includes(q))) return 3
      if (q.length < 3) return 0
      return fields.some(x => { let i = 0; for (const char of x) if (char === q[i]) i++; return i === q.length }) ? 1 : 0
    }
    function Panel() {
      const [tab, setTab] = React.useState('settings')
      const [settings, setSettings] = React.useState(null)
      const [defaults, setDefaults] = React.useState(null)
      const [state, setState] = React.useState(null)
      const [packs, setPacks] = React.useState([])
      const [memeConnected, setMemeConnected] = React.useState(false)
      const [installed, setInstalled] = React.useState(new Set())
      const [query, setQuery] = React.useState('')
      const [preview, setPreview] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState(false)
      const [folderFiles, setFolderFiles] = React.useState([])
      const [folderName, setFolderName] = React.useState('')
      const [recognizeImport, setRecognizeImport] = React.useState(false)
      React.useEffect(() => {
        let live = true
        api('/companion-mood-api?op=settings').then(data => {
          if (live) { setSettings(data.settings); setDefaults(data.defaults); setState(data.state) }
        }).catch(e => { if (live) { setNotice(e.message); setError(true) } })
        const timer = setInterval(() => {
          api('/companion-mood-api?op=settings').then(data => { if (live) setState(data.state) }).catch(() => {})
        }, 30000)
        return () => { live = false; clearInterval(timer) }
      }, [])
      async function discover(refresh = false) {
        setNotice('正在读取图库目录…'); setError(false)
        try {
          const local = await api('/dsh-memes-api?packId=__companion_probe__&q=__companion_no_match__')
          setInstalled(new Set((local.packs || []).map(p => p.id)))
          const dir = await api('/dsh-memes-api?remoteDir=1')
          if (!Array.isArray(dir.remoteDir)) throw new Error(dir.remoteDirError || '目录暂不可用')
          setPacks(dir.remoteDir); setMemeConnected(true); setNotice('已连接 dsh-meme · ' + dir.remoteDir.length + ' 个图库')
        } catch (e) {
          try {
            const dir = await api('/companion-mood-api?op=discover' + (refresh ? '&refresh=1' : ''))
            setPacks(dir.packs || []); setInstalled(new Set()); setMemeConnected(false)
            setNotice('dsh-meme 未连接，可浏览图库；安装需运行 dsh-meme')
          } catch (other) { setNotice(other.message); setError(true) }
        }
      }
      React.useEffect(() => { if (tab === 'discover' && !packs.length) void discover() }, [tab])
      async function save() {
        setBusy(true); setNotice('正在保存…'); setError(false)
        try { const result = await api('/companion-mood-api', { op: 'settings', settings }); setSettings(result.settings); setNotice('已保存，下一轮聊天或检查时生效') }
        catch (e) { setNotice(e.message); setError(true) }
        finally { setBusy(false) }
      }
      async function install(pack) {
        const archive = /^https:\/\//.test(pack.archiveUrl || '') && /^[a-f0-9]{64}$/i.test(pack.sha256 || '')
        const manifest = /^https:\/\//.test(pack.manifestUrl || '')
        if (!archive && !manifest) { setNotice('此图库缺少可验证的 ZIP 或远程清单'); setError(true); return }
        setBusy(true); setError(false); setNotice('正在安装“' + pack.name + '”…')
        try {
          const body = archive
            ? { op: 'installRemoteArchive', archiveUrl: pack.archiveUrl, sha256: pack.sha256, packId: pack.id, name: pack.name, version: pack.version }
            : { op: 'subscribeRemote', manifestUrl: pack.manifestUrl, packId: pack.id }
          const job = await api('/dsh-memes-api', body)
          if (!job.id) throw new Error('dsh-meme 未返回安装任务')
          for (let n = 0; n < 450; n++) {
            await new Promise(resolve => setTimeout(resolve, 2000))
            const progress = await api('/dsh-memes-api', { op: 'remoteJobStatus', jobId: job.id })
            setNotice(progress.message || '正在安装…')
            if (progress.state === 'error') throw new Error(progress.message || '安装失败')
            if (progress.state === 'done' || progress.state === 'done-with-errors') {
              setInstalled(previous => new Set([...previous, pack.id])); return
            }
          }
          throw new Error('下载仍在进行，请到 dsh-meme 中查看进度')
        } catch (e) { setNotice(e.message); setError(true) }
        finally { setBusy(false) }
      }
      function selectFolder(event) {
        const files = Array.from(event.target.files || [])
        setFolderFiles(files)
        setFolderName(files[0]?.webkitRelativePath?.split('/')[0] || '我的表情包')
        setNotice(files.length ? '已选择 ' + files.length + ' 个文件' : '')
        setError(false)
      }
      function fileBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
          reader.onerror = () => reject(new Error('读取 ' + file.name + ' 失败'))
          reader.readAsDataURL(file)
        })
      }
      async function importFolder() {
        const files = folderFiles.filter(file => /\.(?:jpe?g|png|gif|webp)$/i.test(file.name))
        if (!files.length) { setNotice('文件夹中没有 jpg、png、gif 或 webp 图片'); setError(true); return }
        if (files.length > 200) { setNotice('一次最多导入 200 张图片，请分批选择'); setError(true); return }
        const tooLarge = files.find(file => !file.size || file.size > 8 * 1024 * 1024)
        if (tooLarge) { setNotice('图片超过 8MB 或为空：' + tooLarge.name); setError(true); return }
        const name = folderName.trim().slice(0, 60)
        if (!name) { setNotice('请填写图库名称'); setError(true); return }
        setBusy(true); setError(false)
        let done = 0
        let failed = 0
        const failures = []
        try {
          const probe = await api('/dsh-memes-api?packId=__companion_probe__&q=__companion_no_match__')
          if (!Array.isArray(probe.packs)) throw new Error('请先在同一 DSH profile 安装并启用 dsh-meme')
          const id = 'companion-' + Date.now().toString(36)
          await api('/dsh-memes-api', { op: 'createMemePack', id, name, description: '从本地文件夹导入的表情包' })
          for (const file of files) {
            setNotice('正在导入 ' + (done + failed + 1) + '/' + files.length + '：' + file.name)
            try {
              const dataBase64 = await fileBase64(file)
              const pathParts = String(file.webkitRelativePath || '').split('/')
              const folderTag = pathParts.length > 2 ? pathParts[1].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) : ''
              let tag = folderTag || 'custom'
              let caption = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 200)
              let keywords = pathParts.length > 2 ? pathParts[1].slice(0, 200) : ''
              if (recognizeImport) {
                try {
                  const found = await api('/dsh-memes-api', { op: 'recognize', fileName: file.name, dataBase64 })
                  tag = found.tag || tag; caption = found.caption || caption; keywords = found.keywords || keywords
                } catch { /* 无视觉模型时仍按文件名和子文件夹导入。 */ }
              }
              await api('/dsh-memes-api', { op: 'upload', tag, fileName: file.name, dataBase64, caption, keywords })
              done++
            } catch (error) { failed++; if (failures.length < 3) failures.push(file.name + '：' + error.message) }
          }
          setNotice('已创建图库“' + name + '”：成功 ' + done + ' 张，失败 ' + failed + ' 张。' + (failures.length ? '失败示例：' + failures.join('；') + '。' : '') + '可在 dsh-meme 图库页编辑描述。')
          setError(failed > 0 || done === 0)
        } catch (e) { setNotice(e.message); setError(true) }
        finally { setBusy(false) }
      }
      const update = (key, value) => setSettings(previous => ({ ...previous, [key]: value }))
      const btn = (label, action, primary = false, disabled = false) => h('button', { type: 'button', className: 'companion-button' + (primary ? ' primary' : ''), disabled: busy || disabled, onClick: action }, label)
      return h('div', { className: 'companion-panel' },
        h('div', { className: 'companion-tabs' }, ...[['settings', '设置'], ['discover', '发现表情包'], ['import', '导入目录']].map(([key, label]) => h('button', { key, type: 'button', className: 'companion-tab' + (tab === key ? ' active' : ''), onClick: () => { setTab(key); setNotice(''); setError(false) } }, label))),
        tab === 'settings' && settings && h(React.Fragment, null,
          h('div', { className: 'companion-box' },
            h('h3', null, '陪伴状态'),
            h('p', { className: 'companion-note' }, state ? '当前情绪：' + state.mood + ' · ' + (state.paused ? '已暂停主动联系' : state.assessmentDueAt ? (state.lastDecision === 'skip' ? '上次决定暂不联系 · 下次评估 ' : '等待停聊后评估 · ') + new Date(state.assessmentDueAt).toLocaleString() : state.nextContactAt ? '下次主动联系不早于 ' + new Date(state.nextContactAt).toLocaleString() : state.lastDecision === 'skip' ? '上次决定暂不联系' : '暂无主动联系计划') : '正在读取…'),
            state?.lastAssessmentError && h('p', { className: 'companion-note' }, '最近评估失败（第 ' + state.assessmentAttempts + ' 次）：' + state.lastAssessmentError + '。将自动重试。'),
            h('label', null, h('input', { type: 'checkbox', checked: settings.enabled, onChange: e => update('enabled', e.target.checked) }), ' 启用陪伴插件')),
          h('div', { className: 'companion-box' }, h('h3', null, '主动聊天'),
            h('p', { className: 'companion-note' }, '助手完成回复、你保持沉默后，AI 才读取这段完整聊天来判断情绪和联系时间。'),
            h('div', { className: 'companion-grid' }, ...fields.map(([key, title, unit, min, max]) => h('label', { key, className: 'companion-label' }, title + '（' + unit + '）', h('input', { className: 'companion-input', type: 'number', min, max, step: 1, value: settings[key], onChange: e => update(key, Number(e.target.value)) }))),
              h('label', { className: 'companion-label' }, '时区', h('input', { className: 'companion-input', value: settings.timeZone, onChange: e => update('timeZone', e.target.value) })),
              h('label', { className: 'companion-label' }, '固定会话 ID（可留空）', h('input', { className: 'companion-input', value: settings.targetSessionId, onChange: e => update('targetSessionId', e.target.value) })))),
          h('div', { className: 'companion-box' }, h('h3', null, '表情包'), h('p', { className: 'companion-note' }, '优先从 dsh-meme 已启用的图库挑选与聊天内容相符的图。'), h('label', { className: 'companion-label' }, '发送偏好', h('select', { className: 'companion-input', value: settings.memeMode, onChange: e => update('memeMode', e.target.value) }, h('option', { value: 'often' }, '经常发'), h('option', { value: 'natural' }, '自然发'), h('option', { value: 'off' }, '关闭'))), h('label', { className: 'companion-label', style: { flexDirection: 'row', alignItems: 'center', marginTop: 16 } }, h('input', { type: 'checkbox', checked: settings.autoCollectMemes, onChange: e => update('autoCollectMemes', e.target.checked) }), ' 自动收藏聊天中合适的表情包'), h('p', { className: 'companion-note' }, '默认关闭。开启后，仅在停聊后评估本轮收到的图片；AI 判断是可复用表情包才收录。最近结果：' + (state?.lastAutoCollectResult || '暂无') + '。识图可能产生模型费用。')),
          h('div', { className: 'companion-actions' }, btn('保存设置', save, true), btn('恢复推荐值', () => setSettings({ ...defaults })))),
        tab === 'discover' && h(React.Fragment, null,
          h('div', { className: 'companion-actions' }, h('input', { className: 'companion-input', style: { flex: 1, minWidth: 180 }, placeholder: '搜索图库、作者或关键词', value: query, onChange: e => setQuery(e.target.value) }), btn('刷新目录', () => discover(true))),
          h('div', { className: 'companion-packs' }, ...packs.filter(pack => fuzzyScore(pack, query)).map(pack => h('div', { key: pack.id, className: 'companion-pack' },
            pack.preview && h('img', { className: 'companion-cover', src: pack.preview, alt: pack.name + ' 封面', loading: 'lazy', onClick: () => setPreview(pack) }),
            h('div', { className: 'companion-pack-body' }, h('h3', null, pack.name), h('p', null, [pack.maintainer || pack.author, pack.version && 'v' + pack.version, pack.count != null && pack.count + ' 张', pack.downloads != null && '↓ ' + pack.downloads].filter(Boolean).join(' · ')), h('p', null, pack.description || '暂无简介'), h('div', { className: 'companion-tags' }, ...(pack.keywords || []).slice(0, 5).map(tag => h('span', { key: tag, className: 'companion-tag' }, tag))), h('div', { className: 'companion-actions' }, btn('预览', () => setPreview(pack)), btn(installed.has(pack.id) ? '更新' : '安装', () => install(pack), true, !memeConnected), !memeConnected && /^https:\/\//.test(pack.archiveUrl || '') && h('a', { href: pack.archiveUrl, target: '_blank', rel: 'noopener noreferrer' }, '下载 ZIP'))))))),
        tab === 'import' && h('div', { className: 'companion-box' },
          h('h3', null, '导入自己的表情包'),
          h('p', { className: 'companion-import-help' }, '选择本机文件夹，将其中的图片建成一个新的 dsh-meme 图库并自动启用。支持 jpg、png、gif、webp；每次最多 200 张，每张不超过 8MB。'),
          h('label', { className: 'companion-label' }, '选择图片文件夹', h('input', { className: 'companion-input', type: 'file', accept: '.jpg,.jpeg,.png,.gif,.webp', multiple: true, ref: element => { if (element) element.webkitdirectory = true }, onChange: selectFolder })),
          h('label', { className: 'companion-label', style: { marginTop: 12 } }, '图库名称', h('input', { className: 'companion-input', value: folderName, maxLength: 60, onChange: e => setFolderName(e.target.value) })),
          h('label', { className: 'companion-label', style: { flexDirection: 'row', alignItems: 'center', marginTop: 12 } }, h('input', { type: 'checkbox', checked: recognizeImport, onChange: e => setRecognizeImport(e.target.checked) }), '导入时用 AI 识图，生成描述和关键词（较慢，可能产生模型费用）'),
          h('div', { className: 'companion-actions' }, btn('导入 ' + folderFiles.length + ' 个文件', importFolder, true, !folderFiles.length))),
        h('p', { className: 'companion-status' + (error ? ' error' : ''), role: 'status' }, notice),
        preview && h('div', { className: 'companion-preview', role: 'dialog', 'aria-modal': true, onClick: e => { if (e.target === e.currentTarget) setPreview(null) } }, h('div', { className: 'companion-preview-inner' }, h('div', { className: 'companion-actions' }, h('h3', { style: { flex: 1 } }, preview.name), btn('关闭', () => setPreview(null))), h('div', { className: 'companion-preview-grid' }, ...((preview.previews?.length ? preview.previews : [preview.preview]).filter(Boolean).slice(0, 24).map(url => h('img', { key: url, src: url, alt: preview.name + ' 预览', loading: 'lazy' }))))))
      )
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => { const tag = document.createElement('style'); tag.dataset.plugin = 'dsh-companion-mood'; tag.textContent = css; document.head.append(tag); return () => tag.remove() })
        const slots = ctx.get('slots')
        if (!slots) return
        slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'companion-mood', order: 40, label: '陪伴' }, () => h(Panel)))
        slots.inject('plugins.bundle.config', () => slots.register({ name: 'plugins.bundle.config', key: 'dsh-companion-mood' }, () => h(Panel)))
      },
    }
  },
})
})()
