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
  async publish(ctx,agent) {
    const info=this.get(agent.id);if(!info)return;
    try {
      const workspace=await ctx.workspaceRegistry.create(agent.session.header.cwd,info.workspaceTitle);
      await workspace.attachSession(agent.id);
      await ctx.sessionController.rename({sessionId:agent.id,title:info.title});
      return this.remember({...info,workspaceId:String(workspace.id),ready:true,error:null});
    } catch(error) {
      // Session history remains available even when workspace cataloguing fails.
      return this.remember({...info,ready:true,error:error.message});
    }
  }
}
