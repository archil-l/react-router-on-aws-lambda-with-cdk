/**
 * MCP-UI Sandbox Route
 *
 * Serves the sandbox HTML page with appropriate CSP headers.
 * The sandbox acts as a security proxy for rendering untrusted MCP app content.
 *
 * CSP (Content Security Policy) is configured via the ?csp= query parameter,
 * which should contain URL-encoded JSON matching the McpUiResourceCsp type.
 */

import type { LoaderFunctionArgs } from "react-router";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

/**
 * Validate CSP domain entries to prevent injection attacks.
 * Rejects entries containing characters that could:
 * - `;` or newlines: break out to new CSP directive
 * - quotes: inject CSP keywords like 'unsafe-eval'
 * - space: inject multiple sources in one entry
 */
function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

/**
 * Build a CSP header string from the MCP UI resource CSP configuration.
 */
function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ") || null;
  const baseUriDomains =
    sanitizeCspDomains(csp?.baseUriDomains).join(" ") || null;

  const directives = [
    // Default: allow same-origin + inline styles/scripts (needed for bundled apps)
    "default-src 'self' 'unsafe-inline'",
    // Scripts: same-origin + inline + eval (some libs need eval) + blob (workers) + specified domains
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    // Styles: same-origin + inline + specified domains
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    // Images: same-origin + data/blob URIs + specified domains
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    // Fonts: same-origin + data/blob URIs + specified domains
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    // Media (audio/video): same-origin + data/blob URIs + specified domains
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    // Network requests: same-origin + specified API/tile domains
    `connect-src 'self' ${connectDomains}`.trim(),
    // Workers: same-origin + blob + data (viteSingleFile inlines workers as data: URIs) + specified domains
    `worker-src 'self' blob: data: ${resourceDomains}`.trim(),
    // Nested iframes: use frameDomains if provided, otherwise block all
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    // Plugins: always blocked (defense in depth)
    "object-src 'none'",
    // Base URI: use baseUriDomains if provided, otherwise block all
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ];

  return directives.join("; ");
}

/**
 * Generate the sandbox HTML page.
 * This includes the sandbox client script that handles message relay.
 * The host origin is baked in server-side to avoid trusting a client-supplied param.
 */
function generateSandboxHtml(hostOrigin: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark">
    <title>MCP-UI Sandbox</title>
    <style>
      html, body {
        margin: 0;
        height: 100vh;
        width: 100vw;
        background-color: transparent;
      }
      body {
        display: flex;
        flex-direction: column;
      }
      * {
        box-sizing: border-box;
      }
      iframe {
        background-color: transparent;
        border: 0px none transparent;
        padding: 0px;
        overflow: hidden;
        flex-grow: 1;
        color-scheme: inherit;
      }
    </style>
  </head>
  <body>
    <script type="module">
      // MCP-UI Sandbox Client - Inline version
      // This is the same logic as sandbox-client.ts but inlined for the route
      
      const RESOURCE_READY = "ui/notifications/sandbox-resource-ready";
      const PROXY_READY = "ui/notifications/sandbox-proxy-ready";
      
      // Ensure we're in an iframe
      if (window.self === window.top) {
        throw new Error("This file is only to be used in an iframe sandbox.");
      }
      
      // Host origin is baked in server-side (referrer unavailable in sandboxed null-origin iframes)
      const EXPECTED_HOST_ORIGIN = ${JSON.stringify(hostOrigin)};

      // Own origin is always "null" for sandboxed iframes without allow-same-origin
      const OWN_ORIGIN = "null";
      
      // Import buildAllowAttribute dynamically
      // Note: In a route-served page, we need to handle this differently
      // For now, we'll implement a simplified version inline
      function buildAllowAttribute(permissions) {
        if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
          return null;
        }
        // Map permission names to Permission Policy directives
        const policyMap = {
          geolocation: "geolocation",
          camera: "camera",
          microphone: "microphone",
          "display-capture": "display-capture",
          fullscreen: "fullscreen",
        };
        const directives = permissions
          .filter(p => policyMap[p])
          .map(p => policyMap[p]);
        return directives.length > 0 ? directives.join("; ") : null;
      }
      
      // Create inner iframe — no src/srcdoc yet, sandbox attr set later in RESOURCE_READY
      const inner = document.createElement("iframe");
      inner.style.cssText = "width:100%; height:100%; border:none;";
      document.body.appendChild(inner);
      
      // Message relay
      window.addEventListener("message", (event) => {
        if (event.source === window.parent) {
          if (event.origin !== EXPECTED_HOST_ORIGIN) {
            console.error("[Sandbox] Rejecting message from unexpected origin:", event.origin);
            return;
          }
          
          if (event.data && event.data.method === RESOURCE_READY) {
            const { html, sandbox, permissions } = event.data.params || {};
            
            if (typeof sandbox === "string") {
              inner.setAttribute("sandbox", sandbox);
            }
            
            const allowAttr = buildAllowAttribute(permissions);
            if (allowAttr) {
              console.log("[Sandbox] Setting allow attribute:", allowAttr);
              inner.setAttribute("allow", allowAttr);
            }
            
            if (typeof html === "string") {
              // Use srcdoc — document.write() silently drops <script type="module">
              inner.srcdoc = html;
            }
          } else if (inner.contentWindow) {
            inner.contentWindow.postMessage(event.data, "*");
          }
        } else if (event.source === inner.contentWindow) {
          if (event.origin !== OWN_ORIGIN) {
            console.error("[Sandbox] Rejecting message from inner iframe:", event.origin);
            return;
          }
          window.parent.postMessage(event.data, EXPECTED_HOST_ORIGIN);
        }
      });
      
      // Notify host that sandbox is ready
      window.parent.postMessage({
        jsonrpc: "2.0",
        method: PROXY_READY,
        params: {},
      }, EXPECTED_HOST_ORIGIN);
    </script>
  </body>
</html>`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  // Parse CSP config from query param: ?csp=<url-encoded-json>
  let cspConfig: McpUiResourceCsp | undefined;
  const cspParam = url.searchParams.get("csp");
  if (cspParam) {
    try {
      cspConfig = JSON.parse(cspParam);
    } catch (e) {
      console.warn("[Sandbox] Invalid CSP query param:", e);
    }
  }

  // Build CSP header
  const cspHeader = buildCspHeader(cspConfig);

  // The host origin is supplied by the client as ?origin=<origin> so it reflects
  // the public-facing URL (e.g. https://ask.archil.io) rather than the internal
  // API Gateway hostname that the Lambda sees in request.url behind CloudFront.
  // Validate it is a well-formed https:// or http://localhost origin to prevent
  // injection of arbitrary values into the baked-in script constant.
  const rawOrigin = url.searchParams.get("origin") ?? "";
  const isValidOrigin = /^https:\/\/[a-zA-Z0-9.-]+(:\d+)?$/.test(rawOrigin) ||
    /^http:\/\/localhost(:\d+)?$/.test(rawOrigin);
  const hostOrigin = isValidOrigin ? rawOrigin : url.origin;

  // Generate and return the HTML
  const html = generateSandboxHtml(hostOrigin);

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": cspHeader,
      // Prevent caching to ensure fresh CSP on each load
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
