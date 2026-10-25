/** Local user preferences, separate from shared workflows and model prompts. */
import { ContractError } from './template-store.mjs'

export class ExecutionSettings {
  constructor(db) {
    this.db = db
    db.exec('CREATE TABLE IF NOT EXISTS delivery_execution_settings(id INTEGER PRIMARY KEY CHECK(id=1), auto_allow_danger INTEGER NOT NULL CHECK(auto_allow_danger IN (0,1)))')
  }
  get() {
    return { autoAllowDangerFullAccess: this.db.prepare('SELECT auto_allow_danger FROM delivery_execution_settings WHERE id=1').get()?.auto_allow_danger === 1 }
  }
  save(value) {
    if (typeof value?.autoAllowDangerFullAccess !== 'boolean') throw new ContractError('INVALID_EXECUTION_SETTINGS', '自动允许完全访问必须是开关')
    this.db.prepare('INSERT INTO delivery_execution_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET auto_allow_danger=excluded.auto_allow_danger').run(value.autoAllowDangerFullAccess ? 1 : 0)
    return this.get()
  }
}
