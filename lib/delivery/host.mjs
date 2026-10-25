/** DSH-owned service: authenticated browser gateway, private scheduler routes. */
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, extname, resolve } from "node:path";
import { relativeInside } from "../native-path.js";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { SessionId } from "@deepseek-ai/dsh-session";
import { apply as integration } from "./integration-host.mjs";
import * as scheduler from "../vendor/dsh-ccpg-orchestrator/lib/index.js";
import { offlineCanvasCss } from "./offline-assets.mjs";
import { configureProjectionStore } from "./projection-guard.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const DELIVERY_ROUTE = "/api/workbuddy-delivery";

/** Invoke the pinned Node handlers in-process. No unauthenticated business ports. */
export async function invokeHandler(handler, url, method = "GET", body) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  Object.assign(req, {
    url,
    method,
    headers: { "content-type": "application/json" },
    socket: { localPort: 0 },
  });
  const res = new EventEmitter(),
    chunks = [];
  Object.assign(res, {
    statusCode: 200,
    headers: {},
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headersSent = true;
      Object.assign(this.headers, headers);
      return this;
    },
    write(chunk) {
      this.headersSent = true;
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) this.write(chunk);
      this.writableEnded = true;
      this.emit("finish");
      return this;
    },
  });
  await handler(req, res);
  if (!res.writableEnded) throw new Error("内部请求未完成");
  return {
    status: res.statusCode,
    headers: res.headers,
    text: Buffer.concat(chunks).toString("utf8"),
  };
}
const asResponse = (result) =>
  new Response(result.text, { status: result.status, headers: result.headers });

const editorGatewayScript = `(() => {
 const original = window.fetch.bind(window), settings = window.__DELIVERY_EDITOR__;
 window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/delivery/editor/')) return original(input, options);
  const response = await original('${DELIVERY_ROUTE}', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action:'editor/request',editorId:settings.editorId,path:url.pathname.split('/api')[1]+url.search,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined}) });
  if (!response.ok) {
    const failure = await response.clone().json().catch(() => ({}));
    console.warn('工作流画布请求失败', JSON.stringify({ action:'editor/request', path:url.pathname.split('/api')[1]+url.search, status:response.status, code:failure.code, error:failure.error }));
  }
  return response;
 };
 window.EventSource = class extends EventTarget { constructor(){super();this.readyState=1;} close(){this.readyState=2;} };
})()`;

export async function mountDelivery(ctx, registry, config) {
  const root = resolve(
    config.deliveryRoot || join(dirname(registry.root), "delivery"),
  );
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  configureProjectionStore(join(root, "business.sqlite"));
  const sessionId = String(SessionId("delivery-control-" + randomUUID()));
  await ctx.sessions.create(SessionId(sessionId), {
    meta: { cwd: workspace },
  });
  await ctx.sessions.flush(ctx.sessions.get(SessionId(sessionId)));
  const nativeRoutes = new Map();
  let businessHandler;
  const scoped = (register) =>
    new Proxy(ctx, {
      get(target, key) {
        if (key === "webServer") return { register };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  await integration(
    scoped((route) => {
      businessHandler = route.handler;
    }),
    {
      root,
      controlSessionId:sessionId,
      upstreamRoot: join(packageRoot, "vendor"),
      compilerRoot: dirname(packageRoot),
      capabilityLibraries: () => registry.libraryRoots,
      workflowLibraries: () => registry.libraries(),
      capabilityRoots: () => registry.roots,
      capabilityCatalog: () =>
        registry.capabilities().filter((item) => item.scope !== "project"),
      editorGatewayScript,
      async invokeNative(connection, path, method, body) {
        const url = new URL("/wf1/api" + path, "http://delivery.local");
        url.searchParams.set("sessionId", connection.sessionId);
        const route = nativeRoutes.get(url.pathname);
        if (!route) throw new Error("未找到内部工作流服务：" + url.pathname);
        const result = await invokeHandler(
          route,
          url.pathname + url.search,
          method,
          body,
        );
        const value = JSON.parse(result.text);
        if (result.status >= 400)
          throw Object.assign(new Error(value.error), {
            status: result.status,
            code: value.code,
          });
        return value;
      },
    },
  );
  scheduler.apply(
    scoped((route) => {
      nativeRoutes.set(route.path, route.handler);
    }),
    { staticDir: "" },
  );
  const dispose = await ctx.connection.fetch.register({
    path: DELIVERY_ROUTE,
    methods: ["POST", "GET"],
    requestBody: "buffered",
    async fetch(request) {
      try {
        if (request.method === "GET") {
          const url = new URL(request.url),
            document = url.searchParams.get("document");
          if (document === "app") {
            const page = url.searchParams.get("page"),
              selected = ["projects", "templates", "runs"].includes(page)
                ? page
                : "projects";
            return new Response(
              readFileSync(
                new URL("./app.html", import.meta.url),
                "utf8",
              ).replace('\"__INITIAL_PAGE__\"', JSON.stringify(selected)),
              { headers: { "content-type": "text/html; charset=utf-8" } },
            );
          }
          if (document === "editor") {
            const id = url.searchParams.get("editorId");
            if (!/^[a-f0-9-]+$/.test(id ?? "")) throw new Error("编辑会话无效");
            return asResponse(
              await invokeHandler(
                businessHandler,
                "/delivery/editor/" + id + "/",
              ),
            );
          }
          throw new Error("页面不存在");
        }
        const body = await request.json();
        if (body.action === "app/document")
          return new Response(
            readFileSync(new URL("./app.html", import.meta.url)),
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        if (body.action === "bootstrap") {
          const providers = ctx.llm
            .listProviders()
            .map(({ id, name }) => ({ id, name }));
          return Response.json({
            version: "0.4.0-preview.15",
            selection: ctx.agentDefaultModel.currentSelection() ?? {},
            providers,
          });
        }
        if (body.action === "models") {
          const models = await ctx.llm.listModels(body.provider);
          return Response.json({
            models: models.map(({ id, name }) => ({ id, name })),
          });
        }
        if (body.action === "editor/html") {
          if (!/^[a-f0-9-]+$/.test(body.editorId ?? ""))
            throw new Error("编辑会话无效");
          return asResponse(
            await invokeHandler(
              businessHandler,
              "/delivery/editor/" + body.editorId + "/",
            ),
          );
        }
        if (body.action === "editor/request") {
          if (
            !/^[a-f0-9-]+$/.test(body.editorId ?? "") ||
            typeof body.path !== "string" ||
            !body.path.startsWith("/") ||
            body.path.includes("..")
          )
            throw new Error("编辑请求无效");
          if (body.path.split("?")[0] === "/events")
            return new Response("", {
              headers: { "content-type": "text/event-stream" },
            });
          return asResponse(
            await invokeHandler(
              businessHandler,
              "/delivery/editor/" + body.editorId + "/api" + body.path,
              body.method,
              body.body,
            ),
          );
        }
        return asResponse(
          await invokeHandler(businessHandler, "/delivery/api", "POST", {
            ...body,
            sessionId,
          }),
        );
      } catch (error) {
        return Response.json(
          { error: error.message, code: error.code ?? "REQUEST_FAILED" },
          { status: 400 },
        );
      }
    },
  });
  ctx.on("dispose", dispose);
  // Assets contain no project or model configuration. Data always uses the gateway.
  ctx.webServer.register({
    kind: "prefix",
    path: "/wf1/assets",
    handler(req, res) {
      const dist = join(packageRoot, "vendor/dsh-ccpg-web/web-dist/assets");
      const path = resolve(
        dist,
        "." +
          decodeURIComponent(new URL(req.url, "http://local").pathname).slice(
            "/wf1/assets".length,
          ),
      );
      if (!relativeInside(dist, path) || !existsSync(path)) {
        res.writeHead(404).end();
        return;
      }
      const mime = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      };
      res
        .writeHead(200, {
          "content-type": mime[extname(path)] || "application/octet-stream",
        })
        .end(extname(path) === ".css"
          ? offlineCanvasCss(readFileSync(path, "utf8"))
          : readFileSync(path));
    },
  });
  ctx.logger?.info?.(
    "项目模式 %s 已就绪，数据目录：%s",
    "0.4.0-preview.15",
    root,
  );
}
