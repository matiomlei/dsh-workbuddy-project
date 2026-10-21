/* Bridge to the unchanged published editor. Not a replacement graph editor. */
(() => {
  const settings = window.__DELIVERY_EDITOR__, nativeFetch = window.fetch.bind(window)
  let revision = settings.revision, queue = Promise.resolve(), flushRequest = null
  const notify = result => window.parent.postMessage({ type: 'delivery-save-result', editorId: settings.editorId, ...result }, location.origin)
  window.fetch = (input, options) => {
    const url = typeof input === 'string' ? input : input.url
    if (options?.method !== 'POST' || !new URL(url, location.href).pathname.endsWith('/api/workflows')) return nativeFetch(input, options)
    const requestId = flushRequest; flushRequest = null
    const body = JSON.parse(options.body)
    const task = queue.then(async () => {
      try {
        const response = await nativeFetch(input, { ...options, body: JSON.stringify({ ...body, __deliveryExpectedRevision: revision }) })
        const result = await response.clone().json()
        if (response.ok) revision = result.revision
        notify({ requestId, ok: response.ok, revision, error: result.error, code: result.code })
        return response
      } catch (error) { notify({ requestId, ok: false, error: error.message }); throw error }
    })
    queue = task.catch(() => {})
    return task
  }
  window.addEventListener('message', event => {
    if(event.origin === location.origin && event.source === window.parent && event.data?.type === 'delivery-revision') { revision = event.data.revision; return }
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'delivery-flush') return
    const button = document.querySelector('button[aria-label="保存"]')
    if (!button) { notify({ requestId: event.data.requestId, ok: false, error: '画布尚未就绪，请稍后重试。' }); return }
    flushRequest = event.data.requestId; button.click()
  })
  // This prototype edits drafts only. Execution and project runs remain separate.
  const hideRuntime = () => {
    for (const button of document.querySelectorAll('button')) {
      const label = button.getAttribute('aria-label') ?? ''
      if (['运行工作流', '试运行此节点'].includes(label) || ['文稿', '历史', '工作流'].includes(button.textContent.trim())) button.style.display = 'none'
    }
    for (const panel of document.querySelectorAll('[aria-label="运行结果"],[aria-label="画布快捷指令"]')) panel.style.display = 'none'
  }
  window.addEventListener('DOMContentLoaded', () => { hideRuntime(); new MutationObserver(hideRuntime).observe(document.body, { childList: true, subtree: true }) })
})()
