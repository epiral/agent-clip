import { invoke } from "@pinixai/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "./config";
import { dataRoot } from "./paths";
import { humanSize, pinixDataURLPrefix } from "./fs";

interface BrowserPageInfo {
  url?: string;
  title?: string;
}

interface BrowserNavigateResult {
  url: string;
  title: string;
}

interface BrowserEvaluateResult {
  result: unknown;
}

interface BrowserScreenshotResult {
  base64: string;
}

interface BrowserCookiesResult {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }>;
}

export function registerBrowserCommands(
  register: (name: string, description: string, handler: (args: string[], stdin: string) => Promise<string>) => void,
  _cfg: Config,
): void {
  register(
    "browser",
    `Control the user's browser.
  browser open <url>                  - open URL in current tab
  browser snapshot [--interactive]    - get page snapshot with refs
  browser click <ref|selector>        - click element
  browser fill <ref|selector> <text>  - clear and fill text
  browser type <ref|selector> <text>  - type text without clearing
  browser press <key>                 - press key on active element
  browser scroll <dir> [pixels]       - scroll: up/down/left/right
  browser eval <script>               - execute JavaScript
  browser get text|url|title [ref]    - get text or page info
  browser screenshot                  - take screenshot
  browser close                       - request tab close
  browser back|forward|refresh        - navigate history
  browser tabs                        - show current tab info
  browser tab-new [url]               - request new tab
  browser tab-select <id>             - unsupported on current provider
  browser tab-close [id]              - unsupported on current provider`,
    async (args) => browserCommand(args),
  );
}

async function browserCommand(args: string[]): Promise<string> {
  if (args.length === 0) {
    throw new Error("usage: browser <action> [args...]");
  }

  const action = args[0];
  const rest = args.slice(1);

  switch (action) {
    case "open":
      if (rest.length === 0) {
        throw new Error("usage: browser open <url>");
      }
      return formatPageInfo(await browserNavigate(rest[0]));
    case "snapshot": {
      const interactive = rest.includes("--interactive") || rest.includes("-i");
      const result = await browserEvaluate(buildSnapshotScript(interactive));
      return stringifyBrowserValue(result.result);
    }
    case "click":
      if (rest.length === 0) {
        throw new Error("usage: browser click <ref|selector>");
      }
      await browserClick(rest[0]);
      return "OK";
    case "fill":
      if (rest.length < 2) {
        throw new Error("usage: browser fill <ref|selector> <text>");
      }
      await browserFill(rest[0], rest.slice(1).join(" "));
      return "OK";
    case "type":
      if (rest.length < 2) {
        throw new Error("usage: browser type <ref|selector> <text>");
      }
      await browserType(rest[0], rest.slice(1).join(" "));
      return "OK";
    case "press":
      if (rest.length === 0) {
        throw new Error("usage: browser press <key>");
      }
      await browserPress(rest[0]);
      return "OK";
    case "scroll":
      if (rest.length === 0) {
        throw new Error("usage: browser scroll <dir> [pixels]");
      }
      await browserScroll(rest[0], rest[1] ? Number.parseInt(rest[1], 10) : 300);
      return "OK";
    case "eval":
      if (rest.length === 0) {
        throw new Error("usage: browser eval <script>");
      }
      return stringifyBrowserValue((await browserEvaluate(rest.join(" "))).result);
    case "get":
      if (rest.length === 0) {
        throw new Error("usage: browser get text|url|title [ref]");
      }
      return browserGet(rest[0], rest[1]);
    case "screenshot":
      return browserScreenshot();
    case "back":
      return formatPageInfo(await browserNavigateHistory("back"));
    case "forward":
      return formatPageInfo(await browserNavigateHistory("forward"));
    case "refresh":
      return formatPageInfo(await browserRefresh());
    case "close":
      await browserEvaluate("window.close(); true;");
      return "Close requested.";
    case "tabs":
      return formatPageInfo(await getCurrentPageInfo());
    case "tab-new":
      await browserEvaluate(`window.open(${JSON.stringify(rest[0] ?? "about:blank")}, '_blank'); true;`);
      return "New tab requested.";
    case "tab-select":
    case "tab-close":
      throw new Error(`${action} is not supported by the current browser provider`);
    default:
      throw new Error(`unknown browser action: ${action}`);
  }
}

async function browserNavigate(url: string): Promise<BrowserNavigateResult> {
  return await invoke("browser", "navigate", { url, waitUntil: "domcontentloaded" }) as BrowserNavigateResult;
}

async function browserClick(refOrSelector: string): Promise<void> {
  await invoke("browser", "click", { selector: selectorFromRef(refOrSelector) });
}

async function browserType(refOrSelector: string, text: string): Promise<void> {
  await invoke("browser", "type", { selector: selectorFromRef(refOrSelector), text });
}

async function browserFill(refOrSelector: string, text: string): Promise<void> {
  await browserEvaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selectorFromRef(refOrSelector))});
    if (!el) throw new Error(${JSON.stringify(`Element not found: ${refOrSelector}`)});
    if ('value' in el) {
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.isContentEditable) {
      el.textContent = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    throw new Error('Element is not editable');
  })()`);
}

async function browserPress(key: string): Promise<void> {
  await browserEvaluate(`(() => {
    const target = document.activeElement || document.body;
    const init = { key: ${JSON.stringify(key)}, bubbles: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    if (${JSON.stringify(key)} === 'Enter' && target instanceof HTMLElement && typeof target.click === 'function') {
      const form = target.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
    return true;
  })()`);
}

async function browserScroll(direction: string, pixels: number): Promise<void> {
  const normalized = Number.isFinite(pixels) && pixels > 0 ? pixels : 300;
  const delta = {
    up: { x: 0, y: -normalized },
    down: { x: 0, y: normalized },
    left: { x: -normalized, y: 0 },
    right: { x: normalized, y: 0 },
  }[direction];
  if (!delta) {
    throw new Error(`invalid scroll direction: ${direction}`);
  }
  await browserEvaluate(`window.scrollBy(${delta.x}, ${delta.y}); true;`);
}

async function browserGet(attribute: string, refOrSelector?: string): Promise<string> {
  switch (attribute) {
    case "url":
      return (await getCurrentPageInfo()).url || "";
    case "title":
      return (await getCurrentPageInfo()).title || "";
    case "text": {
      const selector = refOrSelector ? selectorFromRef(refOrSelector) : "body";
      const result = await browserEvaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error(${JSON.stringify(`Element not found: ${refOrSelector ?? selector}`)});
        return (el.innerText || el.textContent || '').trim();
      })()`);
      return stringifyBrowserValue(result.result);
    }
    default:
      throw new Error(`unsupported browser get attribute: ${attribute}`);
  }
}

async function browserEvaluate(js: string): Promise<BrowserEvaluateResult> {
  return await invoke("browser", "evaluate", { js }) as BrowserEvaluateResult;
}

async function browserScreenshot(): Promise<string> {
  const screenshot = await invoke("browser", "screenshot", {}) as BrowserScreenshotResult;
  const bytes = Buffer.from(screenshot.base64, "base64");
  const filename = `screenshot-${Date.now()}.png`;
  const imageDir = dataRoot("images");
  mkdirSync(imageDir, { recursive: true });
  writeFileSync(join(imageDir, filename), bytes);

  const pageInfo = await getCurrentPageInfo();
  const parts = [];
  if (pageInfo.title) {
    parts.push(`Title: ${pageInfo.title}`);
  }
  if (pageInfo.url) {
    parts.push(`URL: ${pageInfo.url}`);
  }
  parts.push(`Screenshot: ${filename} (${humanSize(bytes.byteLength)})`);
  parts.push(`Render: ![screenshot](${pinixDataURLPrefix}${join("images", basename(filename))})`);
  return parts.join("\n");
}

async function browserNavigateHistory(direction: "back" | "forward"): Promise<BrowserPageInfo> {
  await browserEvaluate(`history.${direction}(); true;`);
  await delay(600);
  return getCurrentPageInfo();
}

async function browserRefresh(): Promise<BrowserPageInfo> {
  const current = await getCurrentPageInfo();
  if (current.url) {
    return browserNavigate(current.url);
  }
  await browserEvaluate("location.reload(); true;");
  await delay(600);
  return getCurrentPageInfo();
}

async function getCurrentPageInfo(): Promise<BrowserPageInfo> {
  const result = await browserEvaluate("JSON.stringify({ url: location.href, title: document.title })");
  if (typeof result.result === "string") {
    try {
      return JSON.parse(result.result) as BrowserPageInfo;
    } catch {
      return {};
    }
  }
  return (result.result as BrowserPageInfo) ?? {};
}

function formatPageInfo(info: BrowserPageInfo): string {
  const parts: string[] = [];
  if (info.title) {
    parts.push(`Title: ${info.title}`);
  }
  if (info.url) {
    parts.push(`URL: ${info.url}`);
  }
  return parts.length > 0 ? parts.join("\n") : "OK";
}

function selectorFromRef(refOrSelector: string): string {
  const trimmed = refOrSelector.trim();
  if (/^@?\d+$/.test(trimmed)) {
    return `[data-pinix-ref="${trimmed.replace(/^@/, "")}"]`;
  }
  return trimmed;
}

function stringifyBrowserValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSnapshotScript(interactiveOnly: boolean): string {
  return `(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    document.querySelectorAll('[data-pinix-ref]').forEach((el) => el.removeAttribute('data-pinix-ref'));

    const selector = ${JSON.stringify(interactiveOnly
      ? 'a,button,input,textarea,select,summary,[role="button"],[contenteditable="true"],[onclick]'
      : 'a,button,input,textarea,select,summary,[role="button"],[contenteditable="true"],[onclick],h1,h2,h3,p,li,article,section,main,nav')};
    const nodes = Array.from(document.querySelectorAll(selector));
    const lines = [
      'Title: ' + document.title,
      'URL: ' + location.href,
      ''
    ];
    let index = 1;
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      node.setAttribute('data-pinix-ref', String(index));
      const tag = node.tagName.toLowerCase();
      const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      const href = node instanceof HTMLAnchorElement ? node.href : '';
      const placeholder = 'placeholder' in node && typeof node.placeholder === 'string' ? node.placeholder : '';
      const label = [text, placeholder, href].filter(Boolean).join(' | ');
      lines.push('@' + index + ' <' + tag + '> ' + (label || '(empty)'));
      index += 1;
    }
    return lines.join('\\n');
  })()`;
}
