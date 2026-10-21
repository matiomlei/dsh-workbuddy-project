    function DeliveryIcon({size=18}) {
      return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6},
        h('rect',{x:3,y:3,width:6,height:6,rx:1.5}),h('rect',{x:15,y:15,width:6,height:6,rx:1.5}),h('path',{d:'M9 6h6a3 3 0 0 1 3 3v6M6 9v9h9'}))
    }
    function DeliveryPanel() {
      const [page,setPage]=useState('projects'),[navigationError,setNavigationError]=useState('')
      const frame=useRef(null),pending=useRef(null)
      useEffect(()=>{const receive=event=>{if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='delivery-navigation-ready'||!pending.current)return;const item=pending.current;pending.current=null;clearTimeout(item.timer);event.data.error?setNavigationError(event.data.error):setPage(item.page)};window.addEventListener('message',receive);return()=>{window.removeEventListener('message',receive);if(pending.current)clearTimeout(pending.current.timer)}},[])
      const navigate=id=>{if(id===page||pending.current)return;setNavigationError('');if(page!=='templates'||!frame.current){setPage(id);return}const timer=setTimeout(()=>{pending.current=null;setNavigationError('画布未响应，请保存草稿后重试。')},15000);pending.current={page:id,timer};frame.current.contentWindow.postMessage({type:'delivery-prepare-navigation'},location.origin)}
      const tabs=[['projects','项目'],['templates','工作流模板'],['capabilities','能力库'],['runs','运行记录']]
      return h('div',{style:{height:'100%',display:'flex',flexDirection:'column',background:'#f5f7fa',color:'#172637',minWidth:0}},
        h('header',{style:{padding:'20px 28px 0',background:'#fff',borderBottom:'1px solid #e3e8ef'}},
          h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:18}},h(DeliveryIcon,{size:24}),h('strong',{style:{fontSize:20}},'项目交付'),h('span',{style:{fontSize:11,color:'#687787',border:'1px solid #dfe6ef',borderRadius:5,padding:'2px 7px'}},'PREVIEW 0.4')),
          h('nav',{style:{display:'flex',gap:28}},tabs.map(([id,label])=>h('button',{key:id,onClick:()=>navigate(id),style:{background:'none',border:0,borderBottom:page===id?'2px solid #087e8b':'2px solid transparent',color:page===id?'#087e8b':'#647184',fontWeight:page===id?650:450,padding:'0 0 13px',cursor:'pointer',fontSize:14}},label)))),
        navigationError?h('div',{style:{padding:'8px 28px',color:'#ad3434'}},navigationError):null,
        page==='capabilities'?h('div',{style:{overflow:'auto',padding:24,flex:1}},h(CapabilitySection)):
        h('iframe',{ref:frame,key:page,title:'项目交付 · '+tabs.find(x=>x[0]===page)[1],src:'/api/workbuddy-delivery?document=app&page='+page,style:{border:0,width:'100%',flex:1,minHeight:0}}))
    }
    function mountDeliveryClient(ctx) {
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'workbuddy-delivery',order:25,label:'项目交付'},DeliveryIcon))
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'workbuddy-delivery'},DeliveryPanel))
    }
