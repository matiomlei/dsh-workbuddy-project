/**
 * The settings page's JSON bridge.
 *
 * The Typert Remote path is generated at build time from decorated methods, so
 * a package with no build step cannot add a namespace that way. The connection's
 * **exact Fetch route** registry is the supported alternative: a route below
 * `/api` is dispatched only after the carrier has applied the browser trust
 * fence and session-cookie authentication, so this endpoint is exactly as
 * protected as every other Host RPC.
 *
 * @module dsh-workbuddy-project/route
 */

/** The one path the settings page calls. */
export const PROJECTS_ROUTE = '/api/workbuddy-project'

/** Methods the settings page may dispatch. */
const ACTIONS = new Set(['libraries', 'saveLibrary', 'removeLibrary', 'syncLibrary', 'list', 'get', 'options', 'describe', 'create', 'update', 'apply', 'checkConnectors', 'remove', 'templates', 'templateDraft', 'fromTemplate', 'capabilities', 'capability', 'contribute', 'saveCapability', 'previewSkill', 'expertDefinition'])

/** Fields each action cannot run without. A missing one is a malformed request. */
const REQUIRED = {
  saveLibrary: ['config'],
  syncLibrary: ['library'],
  removeLibrary: ['library'],
  get: ['id'],
  describe: ['id'],
  apply: ['id'],
  checkConnectors: ['id'],
  remove: ['id'],
  create: ['config'],
  update: ['config'],
  fromTemplate: ['template', 'cwd'],
  templateDraft: ['template'],
  capability: ['library', 'path'],
  contribute: ['library', 'changes'],
  saveCapability: ['library', 'changes'],
  previewSkill: ['directory'],
  expertDefinition: ['expert'],
}

/** Fields whose value must be a non-empty array rather than a string. */
const ARRAY_FIELDS = new Set(['changes'])

/**
 * Build the route registration for one project service.
 * @param service - the project registry service.
 * @returns the connection fetch route.
 */
export function projectRoute(service) {
  return {
    path: PROJECTS_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let payload
      try {
        payload = await request.json()
      } catch {
        return respond({ ok: false, error: { message: 'request body must be JSON' } }, 400)
      }
      const action = payload?.action
      if (typeof action !== 'string' || !ACTIONS.has(action)) {
        return respond({ ok: false, error: { message: `unknown action ${JSON.stringify(action)}` } }, 400)
      }
      try {
        requireFields(action, payload)
      } catch (error) {
        return respond({ ok: false, error: { message: message(error) } }, 400)
      }
      try {
        return respond({ ok: true, value: await dispatch(service, action, payload) })
      } catch (error) {
        // A refused project edit is an ordinary outcome for this form, so it
        // travels as a 200 with ok:false rather than as a transport failure.
        return respond({ ok: false, error: { message: message(error) } })
      }
    },
  }
}

function requireFields(action, payload) {
  for (const field of REQUIRED[action] ?? []) {
    const value = payload[field]
    if (ARRAY_FIELDS.has(field)) {
      if (!Array.isArray(value) || value.length === 0) throw new Error(`this action needs a non-empty "${field}" array`)
      continue
    }
    if (field !== 'config' && field !== 'server') {
      if (typeof value !== 'string' || value.trim() === '') throw new Error(`this action needs a non-empty "${field}"`)
      continue
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`this action needs a "${field}" object`)
    }
  }
}

async function dispatch(service, action, payload) {
  switch (action) {
    case 'saveCapability': return service.saveCapability(payload)
    case 'libraries': return service.libraries()
    case 'saveLibrary': return service.saveLibrary(payload.config)
    case 'removeLibrary': return service.removeLibrary(payload.library)
    case 'syncLibrary': return service.syncLibrary(payload.library)
    case 'list':
      return service.list()
    case 'get':
      return service.get(payload.id)
    case 'expertDefinition':
      return service.expertDefinition(payload)
    case 'previewSkill':
      return service.previewSkill(payload)
    case 'options':
      return service.options(payload.cwd)
    case 'describe':
      return service.describe(payload.id)
    case 'create':
      return service.create(payload.config)
    case 'update':
      return service.update(payload.config)
    case 'apply':
      return service.apply(payload.id, { preview: payload.preview === true, validate: payload.validate, refresh: payload.refresh === true })
    case 'checkConnectors':return service.checkConnectors(payload.id)
    case 'remove':
      return service.remove(payload.id)
    case 'templates':
      return service.templates()
    case 'templateDraft':
      return service.templateDraft(payload.template)
    case 'fromTemplate':
      return service.createFromTemplate({ template: payload.template, cwd: payload.cwd, validate: payload.validate, ...(payload.config === undefined ? {} : { config: payload.config }) })
    case 'capabilities':
      return service.capabilities()
    case 'capability':
      return service.readCapability({ key: payload.key, projectId: payload.projectId, library: payload.library, path: payload.path, file: payload.file })
    case 'contribute':
      return service.contribute({
        library: payload.library,
        changes: payload.changes,
        ...(payload.message === undefined ? {} : { message: payload.message }),
        ...(payload.branch === undefined ? {} : { branch: payload.branch }),
      })
    /* v8 ignore next -- ACTIONS and this switch are updated together */
    default:
      throw new Error(`unknown action ${JSON.stringify(action)}`)
  }
}

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}
