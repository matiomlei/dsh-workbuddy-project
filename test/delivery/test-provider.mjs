/** Deterministic local adapter for isolated product acceptance, never packaged. */
import { starterOperations, starterStageNames } from "./starter-fixture.mjs";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export const name = "delivery-test-provider";
export const inject = ["llm", "webServer"];
export function apply(ctx) {
  ctx.webServer.register({
    kind: "exact",
    path: "/test-library-mcp",
    async handler(req, res) {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const message = JSON.parse(raw);
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "library-probe", version: "1" },
            }
          : message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "inspect",
                    description: "Library MCP acceptance probe",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              }
            : { content: [{ type: "text", text: "LIBRARY_MCP_OK" }] };
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    },
  });
  class TestAdapter extends LlmAdapter {
    providerInfo(provider) {
      return { id: provider, name: "Product acceptance adapter" };
    }
    async listModels(provider) {
      return [
        {
          provider,
          id: "local-test",
          name: "Local test",
          inputModalities: ["text"],
        },
      ];
    }
    async resolveModel(provider, id) {
      return { provider, id, name: id, context: { contextWindow: 131072 } };
    }
    async *stream(options) {
      appendFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "test-model-requests.jsonl",
        ),
        JSON.stringify({
          provider: options.provider,
          model: options.model,
          system: options.system,
          messages: options.messages,
          tools: options.tools,
        }) + "\n",
      );
      if (options.signal?.aborted) throw options.signal.reason;
      const text = options.messages
        .filter((m) => m.role === "user")
        .flatMap((m) => m.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .find((t) => t.startsWith("TEST_OPERATIONS:") || t.startsWith("当前阶段："));
      const operations =
        text && !options.purpose
          ? text.startsWith("当前阶段：")
            ? starterOperations[starterStageNames[text.split("\n")[0].slice("当前阶段：".length)]] ?? []
            : JSON.parse(text.slice("TEST_OPERATIONS:".length).split("\n")[0])
          : [];
      const results = options.messages.filter((m) => m.role === "tool");
      for (let i = 0; i < results.length; i++)
        if (
          results[i].isError ||
          (operations[i]?.expect &&
            !JSON.stringify(results[i]).includes(operations[i].expect))
        )
          throw new Error("TEST_TOOL_RESULT_MISMATCH:" + (operations[i]?.name || "unknown") + ":" + JSON.stringify(results[i]).slice(0,1600));
      const next = operations[results.length];
      if (next) {
        const id = "test-" + results.length,
          args = JSON.stringify(next.args);
        yield { type: "block-start", index: 0, blockType: "tool-call" };
        yield {
          type: "tool-call-delta",
          index: 0,
          id,
          name: next.name,
          argumentsDelta: args,
        };
        yield {
          type: "block-end",
          index: 0,
          block: { type: "tool-call", id, name: next.name, arguments: args },
        };
        yield { type: "finish", reason: { kind: "tool-calls" } };
        return;
      }
      const answer = "本次节点任务已完成，检查依据已记录。";
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: answer };
      yield {
        type: "block-end",
        index: 0,
        block: { type: "text", text: answer },
      };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
  ctx.llm.registerAdapter(["delivery-test"], new TestAdapter());
}
