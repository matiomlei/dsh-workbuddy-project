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
      : page === "settings" ? h("div",{style:{overflow:"auto",padding:24,flex:1}},h(CapabilitySection,{settingsOnly:true}))
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
    await ctx.sessions.refresh();
    ctx.uiWorkspace.openSession(info.sessionId);
  };
  function NativeNodeReturn({sessionId}) {
    const [,update]=useState(0);
    useEffect(()=>{const notify=()=>update(value=>value+1);deliveryNativeSubscribers.add(notify);return()=>deliveryNativeSubscribers.delete(notify);},[]);
    const info=deliveryNativeSessions.get(String(sessionId));
    return info?h('button',{type:'button','data-delivery-node':info.nodeId,title:'返回项目模式：'+info.title,onClick:()=>{sessionStorage.setItem('delivery:return-node',JSON.stringify({requestId:info.requestId,nodeId:info.nodeId}));ctx.layout.selectPanel('workbuddy-delivery');},style:{border:'1px solid #7199a0',borderRadius:6,padding:'5px 10px',background:'transparent',color:'inherit',cursor:'pointer'}},'返回项目节点'):null;
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
