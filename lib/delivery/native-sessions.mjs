/** Durable links to real DSH Sessions. Business execution remains the only writer. */
export class NativeNodeSessions {
  constructor(db, dialogue) {
    this.db=db;this.dialogue=dialogue;
    db.exec('CREATE TABLE IF NOT EXISTS delivery_native_sessions(session_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,node_id TEXT NOT NULL,attempt INTEGER NOT NULL,document_json TEXT NOT NULL)');
  }
  remember(info) {
    const previous=this.get(info.sessionId),value={...previous,...info,readOnly:true};
    this.db.prepare('INSERT INTO delivery_native_sessions VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET document_json=excluded.document_json').run(info.sessionId,info.requestId,info.nodeId,info.attempt,JSON.stringify(value));
    return value;
  }
  get(sessionId) { const row=this.db.prepare('SELECT document_json FROM delivery_native_sessions WHERE session_id=?').get(String(sessionId));return row?JSON.parse(row.document_json):null; }
  list() {return this.db.prepare('SELECT document_json FROM delivery_native_sessions ORDER BY rowid DESC').all().map(row=>JSON.parse(row.document_json));}
  authorize(requestId,nodeId,message) {this.dialogue.live.get(this.dialogue.key(requestId,nodeId))?.authorizedMessages.add(message.id);}
  async admit({agent,messages},next) {
    const info=this.get(agent.id);
    if(!info)return next();
    const live=this.dialogue.live.get(this.dialogue.key(info.requestId,info.nodeId));
    const phase=this.dialogue.thread(info.requestId,info.nodeId)?.phase;
    // Cold resume from the native UI must never mount a default preset and modify
    // a node's accepted worktree. Also reject direct native prompts on a live node.
    if(!live||live.closed||live.agent!==agent||!['executing','revising','explaining'].includes(phase)||messages.some(message=>!live.authorizedMessages.has(message.id)))return {kind:'reject'};
    const decision=await next();
    if(decision.kind==='enter')for(const message of messages)live.authorizedMessages.delete(message.id);
    return decision;
  }
  async hideLegacy(ctx,sessionId) {
    const info=this.get(sessionId);
    if(!info?.legacySidebar)return;
    const live=this.dialogue.live.get(this.dialogue.key(info.requestId,info.nodeId));
    if(live&&!live.closed&&live.sessionId===String(sessionId))return {deferred:true};
    await ctx.workspaceRegistry.archiveSession(sessionId);
    const managed=new Set(this.list().map(item=>item.sessionId));
    const workspace=info.workspaceId?ctx.workspaceRegistry.get(info.workspaceId):null;
    // Removing a registration retains its directory and logs. Mixed user
    // workspaces are preserved; only project-owned, fully archived groups go.
    if(workspace&&workspace.sessionIds.every(id=>managed.has(String(id))&&ctx.workspaceRegistry.archivedSessionIds.includes(id)))await ctx.workspaceRegistry.delete(workspace.id);
    return {archived:true};
  }
  async migrateLegacy(ctx) {
    const explanations=this.db.prepare("SELECT DISTINCT request_id,node_id,json_extract(document_json,'$.sessionId') AS session_id FROM delivery_node_events WHERE json_extract(document_json,'$.channel')='explanation' AND json_extract(document_json,'$.sessionId') LIKE 'delivery-explain-%'").all();
    for(const row of explanations)if(!this.get(row.session_id))this.remember({sessionId:row.session_id,requestId:row.request_id,nodeId:row.node_id,attempt:0,legacySidebar:true,ready:true});
    for(const info of this.list().filter(item=>item.workspaceId||item.legacySidebar)) {
      this.remember({...info,legacySidebar:true});
      try {await this.hideLegacy(ctx,info.sessionId);} catch(error) {this.remember({...this.get(info.sessionId),sidebarError:error.message});}
    }
  }
  async open(ctx,sessionId) {
    const info=this.get(sessionId);if(!info)throw new Error('节点会话不存在');
    if(info.legacySidebar)await ctx.workspaceRegistry.unarchiveSession(sessionId);
    return info;
  }
  describe(agent,label) {
    // Project workflow execution supplies the composition and lifecycle. Native
    // browsing treats it as one-shot, so continuation stays in the business UI.
    if(agent.session.header.origin==='subagent'&&!agent.session.snapshotEvents().some(event=>event.type==='subagent/descriptor'))agent.session.append('subagent/descriptor',{version:3,mode:'one-shot',provider:'dsh-workbuddy-project',label});
  }
  async publish(ctx,agent) {
    const info=this.get(agent.id);if(!info)return;
    if(info.legacySidebar)await ctx.workspaceRegistry.unarchiveSession(agent.id);
    try {
      // Delegated Sessions keep their private cwd without adding a visible Workspace.
      ctx.sessionTitle.rename(agent.session,info.title);
      await ctx.sessions.flush(agent.session);
      return this.remember({...info,origin:agent.session.header.origin??null,...(agent.session.header.origin==='subagent'?{address:{parentSessionId:String(agent.session.header.parentSession),childSessionId:String(agent.id),mode:'one-shot'}}:{}),ready:true,error:null});
    } catch(error) {
      // Session history remains available even when naming fails.
      return this.remember({...info,ready:true,error:error.message});
    }
  }
}
