"use client";

import { useEffect, useRef, useState } from "react";
import {
  RESOURCE_MIME_TYPE,
  AppBridge,
  PostMessageTransport,
  type McpUiSandboxProxyReadyNotification,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { DynamicToolUIPart } from "~/lib/message-schema";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useThemeContext } from "~/contexts/theme-context";
import { cn } from "~/lib/utils";
import { Spinner } from "~/components/ui/spinner";
import { AppWindowIcon } from "lucide-react";

const log = {
  info: console.log.bind(console, "[MCP-UI]"),
  warn: console.warn.bind(console, "[MCP-UI]"),
  error: console.error.bind(console, "[MCP-UI]"),
};

// Implementation info for AppBridge
const IMPLEMENTATION = { name: "AskArchil Host", version: "1.0.0" };

interface UIResourceData {
  html: string;
  permissions?: McpUiResourcePermissions;
}

/**
 * Fetches a UI resource from the MCP proxy using the standard MCP resources/read
 * JSON-RPC call. The proxy forwards the request to the MCP server with signed AWS
 * credentials; this function only needs a valid JWT for auth.
 */
async function fetchUiResource(
  resourceUri: string,
  mcpProxyEndpoint: string,
  jwtToken: string,
): Promise<UIResourceData | null> {
  const response = await fetch(mcpProxyEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${jwtToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri: resourceUri },
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP proxy responded with HTTP ${response.status}`);
  }

  // MCP Streamable HTTP transport may respond with SSE even for single-request calls.
  // Parse the first `data:` line from the event stream when that happens.
  const contentType = response.headers.get("content-type") ?? "";
  let json: {
    result?: { contents?: Array<Record<string, unknown>> };
    error?: { message?: string };
  };
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error("No data line in SSE response");
    json = JSON.parse(dataLine.slice(5).trim());
  } else {
    json = (await response.json()) as {
      result?: { contents?: Array<Record<string, unknown>> };
      error?: { message?: string };
    };
  }

  if (json.error) {
    throw new Error(json.error.message ?? "MCP resources/read failed");
  }

  const contents = json.result?.contents;
  if (!Array.isArray(contents) || contents.length === 0) {
    return null;
  }

  const content = contents[0] as {
    uri?: string;
    mimeType?: string;
    text?: string;
    blob?: string;
    _meta?: { ui?: { permissions?: McpUiResourcePermissions } };
  };

  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    log.warn(
      "Unexpected MIME type:",
      content.mimeType,
      "expected:",
      RESOURCE_MIME_TYPE,
    );
    return null;
  }

  const html = content.text
    ? content.text
    : content.blob
      ? atob(content.blob)
      : null;

  if (!html) return null;

  return { html, permissions: content._meta?.ui?.permissions };
}

/**
 * Loads the sandbox proxy iframe and returns a promise that resolves
 * when the sandbox is ready to receive HTML content.
 *
 * Uses srcdoc instead of src — Chrome blocks same-origin URLs from loading
 * into null-origin sandboxed iframes (allow-scripts without allow-same-origin).
 */
async function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxUrl: string,
): Promise<boolean> {
  // Prevent reload if already loaded
  if (iframe.srcdoc) return false;

  const readyNotification: McpUiSandboxProxyReadyNotification["method"] =
    "ui/notifications/sandbox-proxy-ready";

  const readyPromise = new Promise<boolean>((resolve) => {
    const listener = ({ source, data }: MessageEvent) => {
      if (
        source === iframe.contentWindow &&
        data?.method === readyNotification
      ) {
        log.info("Sandbox proxy ready");
        window.removeEventListener("message", listener);
        resolve(true);
      }
    };
    window.addEventListener("message", listener);
  });

  log.info("Loading sandbox proxy...");
  const response = await fetch(sandboxUrl);
  const html = await response.text();
  // Set srcdoc AFTER the listener is registered to avoid race condition
  iframe.srcdoc = html;

  return readyPromise;
}

/**
 * Hooks into AppBridge.oninitialized and returns a Promise that resolves
 * when the MCP App is initialized (i.e., when the inner iframe is ready).
 */
function hookInitializedCallback(appBridge: AppBridge): Promise<void> {
  const oninitialized = appBridge.oninitialized;
  return new Promise<void>((resolve) => {
    appBridge.oninitialized = (...args) => {
      resolve();
      appBridge.oninitialized = oninitialized;
      appBridge.oninitialized?.(...args);
    };
  });
}

/**
 * Fetches a fresh JWT token from the web app's /api/jwt-token endpoint.
 */
async function fetchJwtToken(): Promise<string> {
  const response = await fetch("/api/jwt-token");
  if (!response.ok) throw new Error("Failed to fetch JWT token");
  const data = (await response.json()) as { token: string };
  return data.token;
}

interface McpToolUIProps {
  tool: DynamicToolUIPart;
  mcpProxyEndpoint: string;
}

/**
 * Renders an MCP tool's UI resource in a sandboxed iframe using AppBridge.
 * Fetches the resource HTML directly from the MCP proxy rather than relying
 * on the streaming lambda to embed it in the tool result.
 */
export function McpToolUI({ tool, mcpProxyEndpoint }: McpToolUIProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const appBridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useThemeContext();

  const sandboxUrl = new URL("/sandbox", window.location.origin);
  sandboxUrl.searchParams.set("origin", window.location.origin); // used server-side to derive EXPECTED_HOST_ORIGIN

  // Propagate theme changes to the MCP app after initialization
  useEffect(() => {
    const appBridge = appBridgeRef.current;
    if (!appBridge || isLoading) return;
    log.info("Sending theme change to MCP app:", theme);
    appBridge.sendHostContextChange({ theme });
  }, [theme, isLoading]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || initializedRef.current) return;

    initializedRef.current = true;

    const initializeApp = async () => {
      try {
        log.info("Starting MCP App initialization...");

        // Fetch JWT for auth
        const jwtToken = await fetchJwtToken();

        // Fetch the UI resource HTML directly from the MCP proxy
        log.info("Fetching UI resource:", tool.resourceUri);
        const uiResource = await fetchUiResource(
          tool.resourceUri!,
          mcpProxyEndpoint,
          jwtToken,
        );
        if (!uiResource) {
          throw new Error(`No UI resource found for ${tool.resourceUri}`);
        }
        const { html, permissions } = uiResource;

        // Wait for sandbox proxy to be ready (this also sets iframe.src)
        const ready = await loadSandboxProxy(iframe, sandboxUrl.href);
        if (!ready) {
          log.warn("Sandbox already loaded, skipping initialization");
          return;
        }

        // Create AppBridge with null client — we proxy tool calls manually
        // via /api/mcp-tool using the JWT for auth.
        const appBridge = new AppBridge(
          null as any,
          IMPLEMENTATION,
          {
            openLinks: {},
            // Advertise server tools capability so the app knows it can call tools
            serverTools: {},
            // Advertise download capability so the app uses our host-side handler
            // (downloads from inside a sandboxed iframe are blocked by the browser)
            downloadFile: {},
          },
          {
            hostContext: {
              theme: document.documentElement.classList.contains("dark")
                ? "dark"
                : "light",
              platform: "web",
              containerDimensions: { maxHeight: 600 },
              displayMode: "inline",
              availableDisplayModes: ["inline"],
            },
          },
        );
        appBridgeRef.current = appBridge;

        // Proxy tool calls from the MCP app to the server via /api/mcp-tool
        appBridge.oncalltool = async (params) => {
          log.info("App requested tool call:", params.name, params.arguments);
          const response = await fetch("/api/mcp-tool", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${jwtToken}`,
            },
            body: JSON.stringify({
              name: params.name,
              arguments: params.arguments ?? {},
            }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(
              (err as { error?: string }).error ?? `HTTP ${response.status}`,
            );
          }
          return response.json() as Promise<CallToolResult>;
        };

        // Set up other handlers before connecting
        appBridge.onopenlink = async (params) => {
          log.info("Open link request:", params);
          window.open(params.url, "_blank", "noopener,noreferrer");
          return {};
        };

        // Handle file downloads from the app — sandboxed iframes can't trigger
        // downloads directly, so the host page does it on their behalf.
        appBridge.ondownloadfile = async (params) => {
          log.info("Download file request:", params);
          for (const item of params.contents) {
            if (item.type === "resource" && "resource" in item) {
              const res = item.resource as {
                uri: string;
                mimeType?: string;
                blob?: string;
                text?: string;
              };
              const filename = res.uri.split("/").pop() ?? "download";
              const mimeType = res.mimeType ?? "application/octet-stream";
              let href: string;
              if (res.blob) {
                href = `data:${mimeType};base64,${res.blob}`;
              } else if (res.text) {
                const bytes = new TextEncoder().encode(res.text);
                const b64 = btoa(String.fromCharCode(...bytes));
                href = `data:${mimeType};base64,${b64}`;
              } else {
                continue;
              }
              const link = document.createElement("a");
              link.href = href;
              link.download = filename;
              link.style.display = "none";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }
          }
          return {};
        };

        appBridge.onloggingmessage = (params) => {
          log.info("Log from MCP App:", params);
        };

        appBridge.onsizechange = async ({ width, height }) => {
          log.info("Size change request:", { width, height });
          if (height !== undefined && iframe) {
            iframe.style.height = `${height}px`;
          }
          if (width !== undefined && iframe) {
            iframe.style.minWidth = `min(${width}px, 100%)`;
          }
        };

        // Hook into initialization callback
        const appInitializedPromise = hookInitializedCallback(appBridge);

        // Connect the app bridge
        log.info("Connecting AppBridge...");
        await appBridge.connect(
          new PostMessageTransport(
            iframe.contentWindow!,
            iframe.contentWindow!,
          ),
        );

        // Send HTML to sandbox along with any permissions declared in the resource metadata
        log.info(
          "Sending HTML to sandbox...",
          permissions ? `(permissions: ${JSON.stringify(permissions)})` : "",
        );
        await appBridge.sendSandboxResourceReady({ html, permissions });

        // Wait for app to initialize
        log.info("Waiting for MCP App to initialize...");
        await appInitializedPromise;
        log.info("MCP App initialized!");

        // Send tool input
        const toolInput =
          tool.input instanceof Object
            ? (tool.input as Record<string, unknown>)
            : {};
        log.info("Sending tool input:", toolInput);
        appBridge.sendToolInput({ arguments: toolInput });

        // Send tool result if available
        if (tool.output) {
          log.info("Sending tool result:", tool.output);
          appBridge.sendToolResult(tool.output as CallToolResult);
        }

        setIsLoading(false);
      } catch (err) {
        log.error("Failed to initialize MCP App:", err);
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    };

    initializeApp();

    // Cleanup
    return () => {
      if (appBridgeRef.current) {
        appBridgeRef.current.teardownResource({}).catch(() => {
          // Ignore errors during cleanup
        });
      }
    };
  }, [
    tool.resourceUri,
    mcpProxyEndpoint,
    tool.input,
    tool.output,
    sandboxUrl.href,
  ]);

  const appTitle = tool.title || tool.toolName;

  return (
    <div className="flex w-full flex-col rounded-lg border bg-card shadow-md">
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2",
          (!isLoading || error) && "border-b",
        )}
      >
        <AppWindowIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{appTitle}</span>
        {isLoading && (
          <Spinner className="ml-auto size-4 shrink-0 text-muted-foreground" />
        )}
      </div>

      {/* Error state */}
      {error && !isLoading && (
        <div className="px-4 py-3 text-sm text-destructive">Error: {error}</div>
      )}

      {/* iframe — sandbox attr must be set before src to avoid Chrome navigation-blocked errors */}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-forms"
        className={cn(
          "w-full border-none bg-transparent rounded-b-lg overflow-hidden",
          isLoading ? "hidden" : "block",
        )}
        style={{ height: "600px" }}
      />
    </div>
  );
}
