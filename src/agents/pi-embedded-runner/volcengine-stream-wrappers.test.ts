import { describe, expect, it } from "vitest";
import {
  createVolcengineFastModeWrapper,
  isVolcengineProvider,
  resolveVolcengineFastMode,
} from "./volcengine-stream-wrappers.js";

// ---------------------------------------------------------------------------
// Helper: capture the payload that would be sent to the provider API
// ---------------------------------------------------------------------------

function capturePayload(
  wrapper: ReturnType<typeof createVolcengineFastModeWrapper>,
  model: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let captured: Record<string, unknown> | undefined;
  const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
    if (opts?.onPayload) {
      const payload: Record<string, unknown> = {};
      opts.onPayload(payload);
      captured = payload;
    }
    return { type: "result", text: "" } as any;
  };

  const wrappedFn = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
  void wrappedFn(model as any, {} as any, {} as any);
  return captured;
}

// ---------------------------------------------------------------------------
// isVolcengineProvider
// ---------------------------------------------------------------------------

describe("isVolcengineProvider", () => {
  it("returns true for volcengine providers", () => {
    expect(isVolcengineProvider("volcengine")).toBe(true);
    expect(isVolcengineProvider("volcengine-plan")).toBe(true);
    expect(isVolcengineProvider("byteplus")).toBe(true);
    expect(isVolcengineProvider("byteplus-plan")).toBe(true);
  });

  it("returns false for non-volcengine providers", () => {
    expect(isVolcengineProvider("openai")).toBe(false);
    expect(isVolcengineProvider("anthropic")).toBe(false);
    expect(isVolcengineProvider("openrouter")).toBe(false);
    expect(isVolcengineProvider("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveVolcengineFastMode
// ---------------------------------------------------------------------------

describe("resolveVolcengineFastMode", () => {
  it("returns true for fastMode: true", () => {
    expect(resolveVolcengineFastMode({ fastMode: true })).toBe(true);
  });

  it("returns false for fastMode: false", () => {
    expect(resolveVolcengineFastMode({ fastMode: false })).toBe(false);
  });

  it("returns true for fast_mode: 'on'", () => {
    expect(resolveVolcengineFastMode({ fast_mode: "on" })).toBe(true);
  });

  it("returns undefined when not set", () => {
    expect(resolveVolcengineFastMode({})).toBeUndefined();
    expect(resolveVolcengineFastMode(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createVolcengineFastModeWrapper — Guard conditions
// ---------------------------------------------------------------------------

describe("createVolcengineFastModeWrapper guards", () => {
  const volcModel = {
    api: "openai-completions",
    provider: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    id: "doubao-seed-1-8-251228",
  };

  const byteplusModel = {
    api: "openai-completions",
    provider: "byteplus",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    id: "seed-1-8-251228",
  };

  it("applies to volcengine provider with correct API and base URL", () => {
    const payload = capturePayload(
      createVolcengineFastModeWrapper(undefined, true),
      volcModel,
    );
    expect(payload).toBeDefined();
    expect(payload!.temperature).toBe(0.3);
  });

  it("applies to byteplus provider", () => {
    const payload = capturePayload(
      createVolcengineFastModeWrapper(undefined, true),
      byteplusModel,
    );
    expect(payload).toBeDefined();
    expect(payload!.temperature).toBe(0.3);
  });

  it("applies to volcengine-plan provider", () => {
    const payload = capturePayload(
      createVolcengineFastModeWrapper(undefined, true),
      { ...volcModel, provider: "volcengine-plan" },
    );
    expect(payload).toBeDefined();
  });

  it("applies to byteplus-plan provider", () => {
    const payload = capturePayload(
      createVolcengineFastModeWrapper(undefined, true),
      { ...byteplusModel, provider: "byteplus-plan" },
    );
    expect(payload).toBeDefined();
  });

  it("skips non-volcengine providers", () => {
    let overridesApplied = false;
    const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
      if (opts?.onPayload) {
        const payload: Record<string, unknown> = {};
        opts.onPayload(payload);
        if (payload.temperature !== undefined) {overridesApplied = true;}
      }
      return { type: "result", text: "" } as any;
    };

    const wrapper = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
    void wrapper({ ...volcModel, provider: "openai" } as any, {} as any, {} as any);
    expect(overridesApplied).toBe(false);
  });

  it("skips wrong API type", () => {
    let overridesApplied = false;
    const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
      if (opts?.onPayload) {
        const payload: Record<string, unknown> = {};
        opts.onPayload(payload);
        if (payload.temperature !== undefined) {overridesApplied = true;}
      }
      return { type: "result", text: "" } as any;
    };

    const wrapper = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
    void wrapper({ ...volcModel, api: "openai-responses" } as any, {} as any, {} as any);
    expect(overridesApplied).toBe(false);
  });

  it("skips unknown base URL", () => {
    let overridesApplied = false;
    const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
      if (opts?.onPayload) {
        const payload: Record<string, unknown> = {};
        opts.onPayload(payload);
        if (payload.temperature !== undefined) {overridesApplied = true;}
      }
      return { type: "result", text: "" } as any;
    };

    const wrapper = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
    void wrapper(
      { ...volcModel, baseUrl: "https://custom-proxy.example.com/v3" } as any,
      {} as any,
      {} as any,
    );
    expect(overridesApplied).toBe(false);
  });

  it("is a no-op when enabled=false", () => {
    let called = false;
    const baseFn = (() => {
      called = true;
      return {} as any;
    }) as any;

    const wrapper = createVolcengineFastModeWrapper(baseFn, false);
    // When disabled, wrapper should return the underlying function directly
    void wrapper(volcModel as any, {} as any, {} as any);
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createVolcengineFastModeWrapper — Payload overrides
// ---------------------------------------------------------------------------

describe("createVolcengineFastModeWrapper payload overrides", () => {
  const volcModel = {
    api: "openai-completions",
    provider: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    id: "doubao-seed-1-8-251228",
  };

  it("injects stream_options, max_tokens, and temperature", () => {
    const payload = capturePayload(
      createVolcengineFastModeWrapper(undefined, true),
      volcModel,
    );
    expect(payload).toBeDefined();
    expect(payload!.stream_options).toEqual({ chunk_result: true });
    expect(payload!.max_tokens).toBe(4096);
    expect(payload!.temperature).toBe(0.3);
  });

  it("does not override existing stream_options", () => {
    let captured: Record<string, unknown> | undefined;
    const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
      if (opts?.onPayload) {
        const payload: Record<string, unknown> = {
          stream_options: { chunk_result: false },
        };
        opts.onPayload(payload);
        captured = payload;
      }
      return { type: "result", text: "" } as any;
    };

    const wrapper = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
    void wrapper(volcModel as any, {} as any, {} as any);
    expect(captured!.stream_options).toEqual({ chunk_result: false });
  });

  it("does not override existing max_tokens", () => {
    let captured: Record<string, unknown> | undefined;
    const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
      if (opts?.onPayload) {
        const payload: Record<string, unknown> = { max_tokens: 8192 };
        opts.onPayload(payload);
        captured = payload;
      }
      return { type: "result", text: "" } as any;
    };

    const wrapper = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
    void wrapper(volcModel as any, {} as any, {} as any);
    expect(captured!.max_tokens).toBe(8192);
  });

  it("does not override existing temperature", () => {
    let captured: Record<string, unknown> | undefined;
    const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
      if (opts?.onPayload) {
        const payload: Record<string, unknown> = { temperature: 0.8 };
        opts.onPayload(payload);
        captured = payload;
      }
      return { type: "result", text: "" } as any;
    };

    const wrapper = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
    void wrapper(volcModel as any, {} as any, {} as any);
    expect(captured!.temperature).toBe(0.8);
  });

  it("chains with existing onPayload callback", () => {
    let originalCalled = false;
    const fakeStreamFn = (_m: unknown, _c: unknown, opts: any) => {
      if (opts?.onPayload) {
        opts.onPayload({});
      }
      return { type: "result", text: "" } as any;
    };

    const wrapper = createVolcengineFastModeWrapper(fakeStreamFn as any, true);
    void wrapper(volcModel as any, {} as any, {
      onPayload: () => {
        originalCalled = true;
      },
    } as any);
    expect(originalCalled).toBe(true);
  });
});
