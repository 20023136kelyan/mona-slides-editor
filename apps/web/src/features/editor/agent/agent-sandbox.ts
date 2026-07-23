import type { AgentAssetService, AgentDocumentContext, AgentSandboxResult } from '@/features/editor/agent/agent-types'

const MAX_CODE_LENGTH = 100_000
const MAX_CONTEXT_LENGTH = 8_000_000
const MAX_RESULT_LENGTH = 4_000_000
const DEFAULT_TIMEOUT_MS = 8_000

const WORKER_SOURCE = String.raw`
"use strict";
const MAX_COMMANDS = 500;
const MAX_ASSET_REQUESTS = 12;
let runNonce = "";
let requestCounter = 0;
const pendingAssets = new Map();

const clone = value => JSON.parse(JSON.stringify(value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 1) => Math.max(1, finite(value, fallback));
const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const assertText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " must be a non-empty string");
  return value;
};
const assertSlide = (context, slideId) => {
  if (!context.slides.some(slide => slide.id === slideId)) throw new Error("Slide not found: " + slideId);
};

const requestAsset = (action, payload) => new Promise((resolve, reject) => {
  if (requestCounter >= MAX_ASSET_REQUESTS) {
    reject(new Error("Asset request limit exceeded"));
    return;
  }
  const requestId = "asset-" + (++requestCounter);
  pendingAssets.set(requestId, { resolve, reject });
  postMessage({ channel: "mona-agent-sandbox", kind: "asset-request", nonce: runNonce, requestId, action, payload });
});

const createSdk = context => {
  let idCounter = 0;
  const commands = [];
  const logs = [];
  const push = command => {
    if (commands.length >= MAX_COMMANDS) throw new Error("Command limit exceeded");
    commands.push(clone(command));
  };
  const id = prefix => "agent-" + prefix + "-" + runNonce.slice(0, 8) + "-" + (++idCounter).toString(36);
  const theme = context.theme;
  const add = (slideId, element) => {
    assertSlide(context, slideId);
    const next = { ...clone(element), id: element.id || id(element.type || "element") };
    push({ type: "element.add", slideId, elements: next });
    return next.id;
  };
  const shapePath = (shape, width, height) => {
    if (shape === "ellipse") {
      const rx = width / 2;
      const ry = height / 2;
      return "M " + rx + " 0 A " + rx + " " + ry + " 0 1 1 " + (rx - 0.01) + " 0 Z";
    }
    if (shape === "roundedRectangle") {
      const radius = Math.min(width, height) * 0.12;
      return "M " + radius + " 0 H " + (width - radius) + " Q " + width + " 0 " + width + " " + radius +
        " V " + (height - radius) + " Q " + width + " " + height + " " + (width - radius) + " " + height +
        " H " + radius + " Q 0 " + height + " 0 " + (height - radius) + " V " + radius + " Q 0 0 " + radius + " 0 Z";
    }
    return "M 0 0 H " + width + " V " + height + " H 0 Z";
  };
  const sdk = Object.create(null);
  sdk.document = Object.freeze({
    getSummary: () => clone(context.summary),
    getSlide: slideId => {
      const slide = context.slides.find(candidate => candidate.id === slideId);
      if (!slide) throw new Error("Slide not found: " + slideId);
      return clone(slide);
    },
  });
  sdk.selection = Object.freeze({ get: () => clone(context.selection) });
  sdk.slides = Object.freeze({
    add: input => {
      const slideId = id("slide");
      push({ type: "slide.add", slides: { id: slideId, elements: [], ...clone(input || {}) } });
      return slideId;
    },
    update: (slideId, patch) => {
      assertSlide(context, slideId);
      push({ type: "slide.update", slideId, props: clone(patch || {}) });
    },
    remove: slideIds => push({ type: "slide.delete", slideIds: clone(slideIds) }),
  });
  sdk.elements = Object.freeze({
    add,
    addText: (slideId, input) => {
      const fontSize = positive(input.fontSize, 24);
      const color = input.color || theme.fontColor || "#1f2937";
      const align = ["left", "center", "right", "justify"].includes(input.align) ? input.align : "left";
      const weight = input.bold ? "font-weight:700;" : "";
      const content = '<p style="font-size:' + fontSize + 'px;color:' + escapeHtml(color) + ';text-align:' + align + ';' + weight + '"><span>' +
        escapeHtml(assertText(input.text, "Text")) + "</span></p>";
      return add(slideId, {
        type: "text",
        left: finite(input.left),
        top: finite(input.top),
        width: positive(input.width, 300),
        height: positive(input.height, 80),
        rotate: finite(input.rotate),
        content,
        defaultFontName: input.fontFamily || theme.fontName || "Arial",
        defaultColor: color,
        lineHeight: 1.25,
        paragraphSpace: 0,
        inset: [0, 0, 0, 0],
        fixedHeight: true,
        vAlign: input.verticalAlign || "middle",
        ...(input.fill ? { fill: input.fill } : {}),
        ...(Number.isFinite(input.opacity) ? { opacity: input.opacity } : {}),
        ...(input.name ? { name: input.name } : {}),
      });
    },
    addShape: (slideId, input) => {
      const width = positive(input.width, 200);
      const height = positive(input.height, 120);
      const fill = input.fill || theme.themeColors?.[0] || "#7c3aed";
      const shape = input.shape || "rectangle";
      const element = {
        type: "shape",
        left: finite(input.left),
        top: finite(input.top),
        width,
        height,
        rotate: finite(input.rotate),
        viewBox: [width, height],
        path: shapePath(shape, width, height),
        fixedRatio: false,
        fill,
        outline: {
          color: input.stroke || "transparent",
          width: Math.max(0, finite(input.strokeWidth)),
          style: "solid",
        },
        ...(Number.isFinite(input.opacity) ? { opacity: input.opacity } : {}),
        ...(input.name ? { name: input.name } : {}),
      };
      if (input.text) {
        const textColor = input.textColor || "#ffffff";
        const fontSize = positive(input.fontSize, 22);
        element.text = {
          content: '<p style="font-size:' + fontSize + 'px;color:' + escapeHtml(textColor) + ';text-align:center"><span>' + escapeHtml(input.text) + "</span></p>",
          defaultFontName: theme.fontName || "Arial",
          defaultColor: textColor,
          align: "middle",
          inset: [8, 12, 8, 12],
        };
      }
      return add(slideId, element);
    },
    addLine: (slideId, input) => {
      const width = positive(input.width, 160);
      const height = Math.max(0, finite(input.height));
      const marker = value => ["", "arrow", "dot"].includes(value) ? value : "";
      const style = ["solid", "dashed", "dotted"].includes(input.dash) ? input.dash : "solid";
      return add(slideId, {
        type: "line",
        left: finite(input.left),
        top: finite(input.top),
        width,
        start: [0, 0],
        end: [width, height],
        points: [marker(input.startMarker), marker(input.endMarker)],
        color: input.color || theme.fontColor || "#1f2937",
        style,
        ...(input.name ? { name: input.name } : {}),
      });
    },
    addChart: (slideId, input) => add(slideId, {
      type: "chart",
      left: finite(input.left),
      top: finite(input.top),
      width: positive(input.width, 420),
      height: positive(input.height, 260),
      rotate: 0,
      chartType: input.chartType || "column",
      data: {
        labels: clone(input.labels || []),
        legends: clone(input.legends || []),
        series: clone(input.series || []),
      },
      themeColors: clone(input.colors || theme.themeColors || ["#6d5dfc", "#f97316", "#14b8a6"]),
      ...(input.fill ? { fill: input.fill } : {}),
      ...(input.name ? { name: input.name } : {}),
    }),
    addTable: (slideId, input) => {
      const rows = Array.isArray(input.rows) ? input.rows : [];
      const columnCount = Math.max(1, ...rows.map(row => Array.isArray(row) ? row.length : 0));
      return add(slideId, {
        type: "table",
        left: finite(input.left),
        top: finite(input.top),
        width: positive(input.width, 520),
        height: positive(input.height, 260),
        rotate: 0,
        outline: { color: "#d1d5db", width: 1, style: "solid" },
        colWidths: Array.from({ length: columnCount }, () => 1 / columnCount),
        cellMinHeight: 36,
        data: rows.map((row, rowIndex) => Array.from({ length: columnCount }, (_, columnIndex) => ({
          id: id("cell"),
          colspan: 1,
          rowspan: 1,
          text: String(row?.[columnIndex] ?? ""),
          style: {
            backcolor: rowIndex === 0 ? (input.headerColor || theme.themeColors?.[0] || "#4338ca") : (input.bodyColor || "#ffffff"),
            color: rowIndex === 0 ? "#ffffff" : (input.textColor || theme.fontColor || "#1f2937"),
            bold: rowIndex === 0,
            align: "left",
            vAlign: "middle",
          },
        }))),
        ...(input.name ? { name: input.name } : {}),
      });
    },
    addImage: (slideId, input) => {
      if (!input.asset || typeof input.asset.src !== "string" || !input.asset.src) throw new Error("A managed asset is required");
      return add(slideId, {
        type: "image",
        left: finite(input.left),
        top: finite(input.top),
        width: positive(input.width, 320),
        height: positive(input.height, 220),
        rotate: finite(input.rotate),
        src: input.asset.src,
        fixedRatio: true,
        ...(Number.isFinite(input.radius) ? { radius: input.radius } : {}),
        name: input.name || input.alt || input.asset.alt || "Managed image",
      });
    },
    update: (slideId, elementId, patch) => {
      assertSlide(context, slideId);
      push({ type: "element.update", payload: { slideId, id: elementId, props: clone(patch || {}) } });
    },
    remove: (slideId, elementIds) => {
      assertSlide(context, slideId);
      push({ type: "element.delete", slideId, elementIds: clone(elementIds) });
    },
  });
  sdk.assets = Object.freeze({
    searchImages: query => requestAsset("searchImages", { query: assertText(query, "Image query").slice(0, 240) }),
    importImage: result => requestAsset("importImage", { result: clone(result) }),
  });
  sdk.log = Object.freeze({
    info: message => logs.push({ level: "info", message: String(message).slice(0, 1000) }),
    warn: message => logs.push({ level: "warn", message: String(message).slice(0, 1000) }),
  });
  return { sdk: Object.freeze(sdk), commands, logs };
};

onmessage = async event => {
  const message = event.data;
  if (!message || message.channel !== "mona-agent-sandbox") return;
  if (message.kind === "asset-response") {
    const pending = pendingAssets.get(message.requestId);
    if (!pending) return;
    pendingAssets.delete(message.requestId);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error || "Managed asset request failed"));
    return;
  }
  if (message.kind !== "run") return;
  runNonce = message.nonce;
  try {
    const context = clone(message.context);
    const { sdk, commands, logs } = createSdk(context);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const execute = new AsyncFunction(
      "mona", "context", "window", "document", "self", "globalThis", "fetch",
      "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker",
      "navigator", "location", "indexedDB", "caches", "Function",
      '"use strict";\n' + message.code
    );
    await execute(
      sdk, Object.freeze(context), undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined
    );
    postMessage({ channel: "mona-agent-sandbox", kind: "complete", nonce: runNonce, commands, logs });
  }
  catch (error) {
    postMessage({
      channel: "mona-agent-sandbox",
      kind: "error",
      nonce: runNonce,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
`

const createSandboxDocument = (): string => {
  const workerLiteral = JSON.stringify(WORKER_SOURCE)
  return `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; style-src 'none'; form-action 'none'; base-uri 'none'">
<script>
"use strict";
const workerSource = ${workerLiteral};
let worker;
const send = value => parent.postMessage(value, "*");
addEventListener("message", event => {
  const message = event.data;
  if (!message || message.channel !== "mona-agent-sandbox") return;
  if (message.kind === "run") {
    if (worker) worker.terminate();
    worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
    worker.onmessage = inner => send(inner.data);
    worker.onerror = error => send({
      channel: "mona-agent-sandbox",
      kind: "error",
      nonce: message.nonce,
      error: error.message || "Sandbox worker failed"
    });
    worker.postMessage(message);
    return;
  }
  if (message.kind === "asset-response") worker?.postMessage(message);
  if (message.kind === "cancel") {
    worker?.terminate();
    worker = undefined;
  }
});
send({ channel: "mona-agent-sandbox", kind: "ready" });
</script>`
}

export interface RunAgentSandboxInput {
  assetService: AgentAssetService
  code: string
  context: AgentDocumentContext
  signal?: AbortSignal
  timeoutMs?: number
}

const createNonce = (): string => (
  globalThis.crypto?.randomUUID?.() ?? `mona-${Date.now()}-${Math.random().toString(36).slice(2)}`
)

export const runAgentSandbox = ({
  assetService,
  code,
  context,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RunAgentSandboxInput): Promise<AgentSandboxResult> => {
  if (code.length > MAX_CODE_LENGTH) return Promise.reject(new Error('Generated program exceeds the 100 KB sandbox limit'))
  if (JSON.stringify(context).length > MAX_CONTEXT_LENGTH) return Promise.reject(new Error('Agent context exceeds the 8 MB sandbox limit'))
  if (signal?.aborted) return Promise.reject(new DOMException('Agent run cancelled', 'AbortError'))

  return new Promise((resolve, reject) => {
    const nonce = createNonce()
    const iframe = document.createElement('iframe')
    iframe.hidden = true
    iframe.sandbox.add('allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.srcdoc = createSandboxDocument()
    const pendingAssetControllers = new Set<AbortController>()
    let settled = false
    let timeout: ReturnType<typeof setTimeout>

    const cleanup = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      window.removeEventListener('message', receive)
      for (const controller of pendingAssetControllers) controller.abort()
      iframe.contentWindow?.postMessage({ channel: 'mona-agent-sandbox', kind: 'cancel', nonce }, '*')
      iframe.remove()
    }
    const fail = (error: unknown) => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const abort = () => fail(new DOMException('Agent run cancelled', 'AbortError'))
    const respondToAssetRequest = async (message: Record<string, unknown>) => {
      const requestId = typeof message.requestId === 'string' ? message.requestId : ''
      const action = message.action
      const payload = message.payload as { query?: unknown; result?: unknown } | undefined
      if (!requestId || (action !== 'searchImages' && action !== 'importImage')) return
      const controller = new AbortController()
      pendingAssetControllers.add(controller)
      try {
        const value = action === 'searchImages'
          ? await assetService.searchImages(typeof payload?.query === 'string' ? payload.query.slice(0, 240) : '', controller.signal)
          : await assetService.importImage(payload?.result as never, controller.signal)
        iframe.contentWindow?.postMessage({
          channel: 'mona-agent-sandbox',
          kind: 'asset-response',
          nonce,
          requestId,
          ok: true,
          value,
        }, '*')
      }
      catch (error) {
        iframe.contentWindow?.postMessage({
          channel: 'mona-agent-sandbox',
          kind: 'asset-response',
          nonce,
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }, '*')
      }
      finally {
        pendingAssetControllers.delete(controller)
      }
    }
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      const message = event.data as Record<string, unknown> | null
      if (!message || message.channel !== 'mona-agent-sandbox') return
      if (message.kind === 'ready') {
        iframe.contentWindow?.postMessage({ channel: 'mona-agent-sandbox', kind: 'run', nonce, code, context }, '*')
        return
      }
      if (message.nonce !== nonce) return
      if (message.kind === 'asset-request') {
        void respondToAssetRequest(message)
        return
      }
      if (message.kind === 'error') {
        fail(new Error(typeof message.error === 'string' ? message.error : 'Agent sandbox failed'))
        return
      }
      if (message.kind !== 'complete') return
      const result: AgentSandboxResult = {
        commands: Array.isArray(message.commands) ? message.commands as AgentSandboxResult['commands'] : [],
        logs: Array.isArray(message.logs) ? message.logs as AgentSandboxResult['logs'] : [],
      }
      if (JSON.stringify(result).length > MAX_RESULT_LENGTH) {
        fail(new Error('Sandbox result exceeds the 4 MB limit'))
        return
      }
      cleanup()
      resolve(result)
    }

    timeout = setTimeout(() => fail(new Error(`Agent sandbox exceeded ${timeoutMs} ms`)), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    window.addEventListener('message', receive)
    document.body.append(iframe)
  })
}
