/* Product adapter for the pinned canvas: draft saves and node capability entry. */
(() => {
  const settings = window.__DELIVERY_EDITOR__,
    nativeFetch = window.fetch.bind(window);
  let revision = settings.revision,
    definition = settings.definition,
    catalog = settings.catalog ?? [];
  let queue = Promise.resolve(),
    flushRequest = null,
    lastNodeId = null,
    pending = false;
  const send = (value) =>
    window.parent.postMessage(
      { editorId: settings.editorId, ...value },
      location.origin,
    );
  const notify = (result) => send({ type: "delivery-save-result", ...result });
  window.fetch = (input, options) => {
    const url = typeof input === "string" ? input : input.url;
    if (
      options?.method !== "POST" ||
      !new URL(url, location.href).pathname.endsWith("/api/workflows")
    )
      return nativeFetch(input, options);
    const requestId = flushRequest;
    flushRequest = null;
    const body = JSON.parse(options.body);
    const task = queue.then(async () => {
      try {
        const response = await nativeFetch(input, {
          ...options,
          body: JSON.stringify({
            ...body,
            __deliveryExpectedRevision: revision,
          }),
        });
        const result = await response.clone().json();
        if (response.ok) {
          revision = result.revision;
          definition = { ...definition, graph: body.graph };
        }
        notify({
          requestId,
          ok: response.ok,
          revision,
          error: result.error,
          code: result.code,
        });
        schedule();
        return response;
      } catch (error) {
        notify({ requestId, ok: false, error: error.message });
        throw error;
      }
    });
    queue = task.catch(() => {});
    return task;
  };
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent)
      return;
    if (event.data?.type === "delivery-revision") {
      revision = event.data.revision;
      if (event.data.definition) definition = event.data.definition;
      if (event.data.catalog) catalog = event.data.catalog;
      schedule();
      return;
    }
    if (event.data?.type !== "delivery-flush") return;
    const button = document.querySelector('button[aria-label="保存"]');
    if (!button) {
      notify({
        requestId: event.data.requestId,
        ok: false,
        error: "画布尚未就绪，请稍后重试。",
      });
      return;
    }
    flushRequest = event.data.requestId;
    button.click();
  });
  const categories = [
    ["expert", "experts", "专家 / 专家团"],
    ["skill", "skills", "Skill"],
    ["connector", "connectors", "MCP 连接器"],
    ["rule", "rules", "规范"],
  ];
  const nodeId = () =>
    document.querySelector(".react-flow__node.selected[data-id]")?.dataset.id ||
    lastNodeId;
  const textNode = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  function capabilityPanel(panel) {
    if (!panel.querySelector(".type-agent")) {
      panel.querySelector(".delivery-capability-panel")?.remove();
      return;
    }
    const id = nodeId();
    if (!id) return;
    const binding = definition?.nodeBindings?.find(
      (binding) => binding.nodeId === id,
    );
    const key = JSON.stringify([
      id,
      binding?.capabilities,
      catalog.map((item) => [item.reference, item.name]),
    ]);
    let holder = panel.querySelector(".delivery-capability-panel");
    if (holder?.dataset.key === key) return;
    if (!holder) {
      holder = document.createElement("section");
      holder.className = "delivery-capability-panel";
      panel.querySelector(".node-panel-scroll")?.prepend(holder);
    }
    holder.dataset.key = key;
    holder.dataset.nodeId = id;
    holder.replaceChildren();
    holder.append(
      textNode("h3", "节点能力库"),
      textNode("p", "从能力库选择专家、Skill、MCP 和规范，保存后固定到模板。"),
    );
    for (const [kind, field, title] of categories) {
      const references = binding?.capabilities?.[field] ?? [],
        row = document.createElement("div");
      row.className = "delivery-capability-row";
      const details = document.createElement("div");
      details.append(
        textNode("strong", title),
        textNode(
          "small",
          references.length
            ? references
                .map(
                  (ref) =>
                    catalog.find((item) => item.reference === ref)?.name || ref,
                )
                .join("、")
            : "未绑定",
        ),
      );
      const button = textNode(
        "button",
        "配置" +
          { expert: "专家", skill: "Skill", connector: "MCP", rule: "规范" }[
            kind
          ],
      );
      button.type = "button";
      button.setAttribute("aria-label", button.textContent);
      button.addEventListener("click", () =>
        send({ type: "delivery-configure-node", nodeId: id, section: kind }),
      );
      row.append(details, button);
      holder.append(row);
    }
    holder.append(
      textNode(
        "p",
        "MCP 工具随绑定自动启用；Skill 包及附带技能在该节点会话中加载。",
      ),
    );
  }
  function present() {
    pending = false;
    for (const button of document.querySelectorAll("button")) {
      const label = button.getAttribute("aria-label") ?? "";
      if (
        ["运行工作流", "试运行此节点"].includes(label) ||
        ["文稿", "历史", "工作流"].includes(button.textContent.trim())
      )
        button.style.display = "none";
    }
    for (const panel of document.querySelectorAll(
      '[aria-label="运行结果"],[aria-label="画布快捷指令"]',
    ))
      panel.style.display = "none";
    for (const panel of document.querySelectorAll(".node-panel")) {
      capabilityPanel(panel);
      for (const section of panel.querySelectorAll(".panel-sec")) {
        const title = section.querySelector(".sec-title");
        if (title?.textContent === "技能") section.style.display = "none";
        if (["工具", "基础工具"].includes(title?.textContent)) {
          if (title.textContent !== "基础工具") title.textContent = "基础工具";
          const hint = section.querySelector(".sec-head .sec-hint");
          if (hint && hint.textContent !== "可选限制")
            hint.textContent = "可选限制";
          const note = section.querySelector(".sec-body>.sec-hint"),
            value = "未勾选 = 默认基础工具；绑定的 MCP 工具自动提供。";
          if (note && note.textContent !== value) note.textContent = value;
        }
      }
    }
  }
  function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(present);
  }
  document.addEventListener(
    "click",
    (event) => {
      const node = event.target.closest?.(".react-flow__node[data-id]");
      if (node) lastNodeId = node.dataset.id;
      schedule();
    },
    true,
  );
  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `.delivery-capability-panel{padding:16px;border:1px solid var(--border,#596575);border-radius:10px;margin:12px 0;background:var(--panel-bg,transparent)}.delivery-capability-panel h3{margin:0 0 8px;font-size:14px}.delivery-capability-panel p{font-size:11px;opacity:.7;margin:8px 0;line-height:1.7}.delivery-capability-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid #8883}.delivery-capability-row div{min-width:0}.delivery-capability-row strong{font-size:12px}.delivery-capability-row small{display:block;opacity:.65;font-size:11px;overflow-wrap:anywhere}.delivery-capability-row button{flex-shrink:0;border:1px solid #8887;border-radius:5px;padding:5px 8px;background:transparent;color:inherit;font-size:11px;cursor:pointer}`;
    document.head.append(style);
    present();
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
})();
