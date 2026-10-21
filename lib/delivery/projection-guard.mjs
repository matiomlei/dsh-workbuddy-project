/** Test-only persistence guard. Its database path is supplied by the isolated host. */
import { DatabaseSync } from 'node:sqlite'
import { canonical, backendProjection } from './template-store.mjs'
function reject(code) { throw Object.assign(new Error(code), { code, status: 409 }) }
let databasePath
export function configureProjectionStore(path) { databasePath = path }
export function guardProjection(id, operation, document, exists) {
  if (typeof id !== 'string' || !id.startsWith('delivery_v_')) return
  const path = databasePath
  if (!path) reject('DELIVERY_PROJECTION_CONFIG_REQUIRED')
  const db = new DatabaseSync(path, { readOnly: true })
  let row
  try { row = db.prepare('SELECT document_json FROM versions WHERE backend_id=?').get(id) } finally { db.close() }
  if (!row) reject('DELIVERY_PROJECTION_NOT_REGISTERED')
  if (operation === 'delete' || exists) reject('DELIVERY_PUBLISHED_IMMUTABLE')
  // Permit first materialization only when it exactly matches a registered version.
  const { updatedAt: _, schemaVersion: __, ...actual } = document
  if (canonical(actual) !== canonical(backendProjection(JSON.parse(row.document_json)))) reject('DELIVERY_PROJECTION_MISMATCH')
}
