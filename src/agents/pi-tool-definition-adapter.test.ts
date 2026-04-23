import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import type { ClientToolDefinition } from "./pi-embedded-runner/run/params.js";
import {
  CLIENT_TOOL_NAME_CONFLICT_PREFIX,
  createClientToolNameConflictError,
  findClientToolNameConflicts,
  isClientToolNameConflictError,
  toClientToolDefinitions,
  toToolDefinitions,
} from "./pi-tool-definition-adapter.js";

type ToolExecute = ReturnType<typeof toToolDefinitions>[number]["execute"];
const extensionContext = {} as Parameters<ToolExecute>[4];

async function executeThrowingTool(name: string, callId: string) {
  const tool = {
    name,
    label: name === "bash" ? "Bash" : "Boom",
    description: "throws",
    parameters: Type.Object({}),
    execute: async () => {
      throw new Error("nope");
    },
  } satisfies AgentTool;

  const defs = toToolDefinitions([tool]);
  const def = defs[0];
  if (!def) {
    throw new Error("missing tool definition");
  }
  return await def.execute(callId, {}, undefined, undefined, extensionContext);
}

async function executeTool(tool: AgentTool, callId: string) {
  const defs = toToolDefinitions([tool]);
  const def = defs[0];
  if (!def) {
    throw new Error("missing tool definition");
  }
  return await def.execute(callId, {}, undefined, undefined, extensionContext);
}

describe("pi tool definition adapter", () => {
  it("wraps tool errors into a tool result", async () => {
    const result = await executeThrowingTool("boom", "call1");

    expect(result.details).toMatchObject({
      status: "error",
      tool: "boom",
    });
    expect(result.details).toMatchObject({ error: "nope" });
    expect(JSON.stringify(result.details)).not.toContain("\n    at ");
  });

  it("normalizes exec tool aliases in error results", async () => {
    const result = await executeThrowingTool("bash", "call2");

    expect(result.details).toMatchObject({
      status: "error",
      tool: "exec",
      error: "nope",
    });
  });

  it("coerces details-only tool results to include content", async () => {
    const tool = {
      name: "memory_query",
      label: "Memory Query",
      description: "returns details only",
      parameters: Type.Object({}),
      execute: (async () => ({
        details: {
          hits: [{ id: "a1", score: 0.9 }],
        },
      })) as unknown as AgentTool["execute"],
    } satisfies AgentTool;

    const result = await executeTool(tool, "call3");
    expect(result.details).toEqual({
      hits: [{ id: "a1", score: 0.9 }],
    });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text?: string }).text).toContain('"hits"');
  });

  it("coerces non-standard object results to include content", async () => {
    const tool = {
      name: "memory_query_raw",
      label: "Memory Query Raw",
      description: "returns plain object",
      parameters: Type.Object({}),
      execute: (async () => ({
        count: 2,
        ids: ["m1", "m2"],
      })) as unknown as AgentTool["execute"],
    } satisfies AgentTool;

    const result = await executeTool(tool, "call4");
    expect(result.details).toEqual({
      count: 2,
      ids: ["m1", "m2"],
    });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text?: string }).text).toContain('"count"');
  });
});

// ---------------------------------------------------------------------------
// toClientToolDefinitions – streaming tool-call argument coercion (#57009)
// ---------------------------------------------------------------------------

function makeClientTool(name: string): ClientToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  };
}

async function executeClientTool(
  params: unknown,
): Promise<{ calledWith: Record<string, unknown> | undefined }> {
  let captured: Record<string, unknown> | undefined;
  const [def] = toClientToolDefinitions([makeClientTool("search")], (_name, p) => {
    captured = p;
  });
  if (!def) {
    throw new Error("missing client tool definition");
  }
  await def.execute("call-c1", params, undefined, undefined, extensionContext);
  return { calledWith: captured };
}

describe("toClientToolDefinitions – param coercion", () => {
  it("passes plain object params through unchanged", async () => {
    const { calledWith } = await executeClientTool({ query: "hello" });
    expect(calledWith).toEqual({ query: "hello" });
  });

  it("parses a JSON string into an object (streaming delta accumulation)", async () => {
    const { calledWith } = await executeClientTool('{"query":"hello","limit":10}');
    expect(calledWith).toEqual({ query: "hello", limit: 10 });
  });

  it("parses a JSON string with surrounding whitespace", async () => {
    const { calledWith } = await executeClientTool('  {"query":"hello"}  ');
    expect(calledWith).toEqual({ query: "hello" });
  });

  it("falls back to empty object for invalid JSON string", async () => {
    const { calledWith } = await executeClientTool("not-json");
    expect(calledWith).toEqual({});
  });

  it("falls back to empty object for empty string", async () => {
    const { calledWith } = await executeClientTool("");
    expect(calledWith).toEqual({});
  });

  it("falls back to empty object for null", async () => {
    const { calledWith } = await executeClientTool(null);
    expect(calledWith).toEqual({});
  });

  it("falls back to empty object for undefined", async () => {
    const { calledWith } = await executeClientTool(undefined);
    expect(calledWith).toEqual({});
  });

  it("falls back to empty object for a JSON array string", async () => {
    const { calledWith } = await executeClientTool("[1,2,3]");
    expect(calledWith).toEqual({});
  });

  it("handles nested JSON string correctly", async () => {
    const { calledWith } = await executeClientTool(
      '{"action":"search","params":{"q":"test","page":1}}',
    );
    expect(calledWith).toEqual({ action: "search", params: { q: "test", page: 1 } });
  });
});

describe("client tool name conflict checks", () => {
  it("detects collisions with existing built-in names after normalization", () => {
    expect(
      findClientToolNameConflicts({
        tools: [makeClientTool("Web_Search"), makeClientTool("exec")],
        existingToolNames: ["web_search", "read"],
      }),
    ).toEqual(["Web_Search"]);
  });

  it("detects duplicate client tool names after normalization", () => {
    expect(
      findClientToolNameConflicts({
        tools: [makeClientTool("Weather"), makeClientTool("weather")],
      }),
    ).toEqual(["Weather", "weather"]);
  });

  it("detects collisions with reserved Pi built-in tool names", () => {
    expect(
      findClientToolNameConflicts({
        tools: [makeClientTool("Bash"), makeClientTool("grep")],
        existingToolNames: ["bash", "edit", "find", "grep", "ls", "read", "write"],
      }),
    ).toEqual(["Bash", "grep"]);
  });

  it("wraps conflict errors with a stable prefix", () => {
    const err = createClientToolNameConflictError(["exec", "Web_Search"]);
    expect(err.message).toBe(`${CLIENT_TOOL_NAME_CONFLICT_PREFIX} exec, Web_Search`);
    expect(isClientToolNameConflictError(err)).toBe(true);
    expect(isClientToolNameConflictError(new Error("other failure"))).toBe(false);
  });
});

function extractJsonFromResult(result: unknown): unknown {
  if (result && typeof result === "object" && "details" in result) {
    return (result as { details: unknown }).details;
  }
  return result;
}

describe("tool call timeout", () => {
  it("times out slow tools", async () => {
    const tool = {
      name: "slow-tool",
      label: "Slow Tool",
      description: "takes forever",
      parameters: Type.Object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return { content: [{ type: "text" as const, text: "done" }], details: { ok: true } };
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool], { toolCallTimeoutSeconds: 0.05 });
    const def = defs[0];
    const result = await def.execute("call-1", {}, undefined, undefined, extensionContext);
    const json = extractJsonFromResult(result);
    expect(json).toMatchObject({
      status: "error",
      tool: "slow-tool",
    });
    expect((json as { error: string }).error).toContain("timed out");
  });

  it("completes fast tools", async () => {
    const tool = {
      name: "fast-tool",
      label: "Fast Tool",
      description: "quick",
      parameters: Type.Object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { content: [{ type: "text" as const, text: "ok" }], details: { fast: true } };
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool], { toolCallTimeoutSeconds: 1 });
    const def = defs[0];
    const result = await def.execute("call-2", {}, undefined, undefined, extensionContext);
    expect(result.details).toMatchObject({ fast: true });
  });

  it("disables timeout when set to 0", async () => {
    const tool = {
      name: "no-timeout-tool",
      label: "No Timeout",
      description: "no timeout",
      parameters: Type.Object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { content: [{ type: "text" as const, text: "ok" }], details: { noTimeout: true } };
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool], { toolCallTimeoutSeconds: 0 });
    const def = defs[0];
    const result = await def.execute("call-3", {}, undefined, undefined, extensionContext);
    expect(result.details).toMatchObject({ noTimeout: true });
  });

  it("handles abort signal", async () => {
    let abortCallback: (() => void) | null = null;
    const mockSignal = {
      aborted: false,
      addEventListener: (_event: string, cb: () => void) => {
        abortCallback = cb;
      },
      removeEventListener: () => {},
      reason: undefined,
      onabort: null,
      throwIfAborted: () => {},
      dispatchEvent: () => true,
    } as unknown as AbortSignal;

    const tool = {
      name: "abort-tool",
      label: "Abort Tool",
      description: "abortable",
      parameters: Type.Object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return { content: [{ type: "text" as const, text: "done" }], details: { ok: true } };
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool], { toolCallTimeoutSeconds: 10 });
    const def = defs[0];

    // Trigger abort shortly after execute starts
    setTimeout(() => {
      if (abortCallback) {
        abortCallback();
      }
    }, 10);
    const result = await def.execute("call-4", {}, mockSignal, undefined, extensionContext);
    const json = extractJsonFromResult(result);
    expect(json).toMatchObject({
      status: "error",
      tool: "abort-tool",
    });
  });

  it("handles tool execution errors", async () => {
    const tool = {
      name: "error-tool",
      label: "Error Tool",
      description: "throws",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("tool broke");
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool], { toolCallTimeoutSeconds: 1 });
    const def = defs[0];
    const result = await def.execute("call-5", {}, undefined, undefined, extensionContext);
    const json = extractJsonFromResult(result);
    expect(json).toMatchObject({
      status: "error",
      tool: "error-tool",
      error: "tool broke",
    });
  });

  it("cleans up listeners on completion", async () => {
    const addSpy = vi.fn();
    const removeSpy = vi.fn();
    const mockSignal = {
      aborted: false,
      addEventListener: addSpy,
      removeEventListener: removeSpy,
      reason: undefined,
      onabort: null,
      throwIfAborted: () => {},
      dispatchEvent: () => true,
    } as unknown as AbortSignal;

    const tool = {
      name: "cleanup-tool",
      label: "Cleanup Tool",
      description: "cleans up",
      parameters: Type.Object({}),
      execute: async () => {
        return { content: [{ type: "text" as const, text: "ok" }], details: { clean: true } };
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool], { toolCallTimeoutSeconds: 5 });
    const def = defs[0];
    await def.execute("call-6", {}, mockSignal, undefined, extensionContext);

    expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("cleans up listeners when timeout fires first", async () => {
    const addSpy = vi.fn();
    const removeSpy = vi.fn();
    const mockSignal = {
      aborted: false,
      addEventListener: addSpy,
      removeEventListener: removeSpy,
      reason: undefined,
      onabort: null,
      throwIfAborted: () => {},
      dispatchEvent: () => true,
    } as unknown as AbortSignal;

    const tool = {
      name: "timeout-cleanup-tool",
      label: "Timeout Cleanup",
      description: "times out and cleans up",
      parameters: Type.Object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return { content: [{ type: "text" as const, text: "done" }], details: { ok: true } };
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool], { toolCallTimeoutSeconds: 0.05 });
    const def = defs[0];
    await def.execute("call-7", {}, mockSignal, undefined, extensionContext);

    expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
