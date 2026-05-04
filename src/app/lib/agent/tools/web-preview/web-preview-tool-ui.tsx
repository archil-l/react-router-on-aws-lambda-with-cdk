"use client";

import type { DynamicToolUIPart } from "~/lib/message-schema";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from "~/components/ai-elements/web-preview";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  Maximize2Icon,
  RefreshCcwIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

export interface WebPreviewToolUIProps {
  tool: DynamicToolUIPart;
  url: string;
  className?: string;
  editUrl?: boolean;
  showNavigationButtons?: boolean;
  showConsole?: boolean;
  title?: string;
}

/**
 * WebPreviewToolUI - Dynamic UI component for the webpreview tool
 *
 * Renders a full-featured web preview with navigation controls,
 * URL bar, iframe preview, and console output.
 */
export function WebPreviewToolUI({
  tool,
  url,
  className,
  editUrl,
  showNavigationButtons,
  showConsole,
  title,
}: WebPreviewToolUIProps) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [history, setHistory] = useState<string[]>([url]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [logs, setLogs] = useState<
    { level: "log" | "warn" | "error"; message: string; timestamp: Date }[]
  >([
    {
      level: "log",
      message: `Loading ${url}`,
      timestamp: new Date(),
    },
  ]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleUrlChange = useCallback(
    (newUrl: string) => {
      setCurrentUrl(newUrl);
      // Add to history
      const newHistory = [...history.slice(0, historyIndex + 1), newUrl];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      // Log the navigation
      setLogs((prev) => [
        ...prev,
        {
          level: "log",
          message: `Navigated to ${newUrl}`,
          timestamp: new Date(),
        },
      ]);
    },
    [history, historyIndex],
  );

  const handleGoBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentUrl(history[newIndex]);
      setLogs((prev) => [
        ...prev,
        {
          level: "log",
          message: `Navigated back to ${history[newIndex]}`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [history, historyIndex]);

  const handleGoForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentUrl(history[newIndex]);
      setLogs((prev) => [
        ...prev,
        {
          level: "log",
          message: `Navigated forward to ${history[newIndex]}`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [history, historyIndex]);

  const handleReload = useCallback(() => {
    // Force iframe reload by setting src to empty then back
    if (iframeRef.current) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = "";
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = currentSrc;
        }
      }, 0);
    }
    setLogs((prev) => [
      ...prev,
      {
        level: "log",
        message: "Page reloaded",
        timestamp: new Date(),
      },
    ]);
  }, []);

  const handleOpenInNewTab = useCallback(() => {
    if (currentUrl) {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
      setLogs((prev) => [
        ...prev,
        {
          level: "log",
          message: `Opened ${currentUrl} in new tab`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [currentUrl]);

  const handleToggleFullscreen = useCallback(() => {
    const container = document.querySelector(
      "[data-web-preview-container]",
    ) as HTMLElement;
    if (container) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    }
  }, []);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  return (
    <WebPreview
      defaultUrl={currentUrl}
      onUrlChange={handleUrlChange}
      className={className}
      style={{ height: "800px", minWidth: "750px" }}
      data-web-preview-container
    >
      <WebPreviewNavigation className="p-1">
        {showNavigationButtons && (
          <WebPreviewNavigationButton
            onClick={handleGoBack}
            tooltip="Go back"
            disabled={!canGoBack}
          >
            <ArrowLeftIcon className="size-3" />
          </WebPreviewNavigationButton>
        )}
        {showNavigationButtons && (
          <WebPreviewNavigationButton
            onClick={handleGoForward}
            tooltip="Go forward"
            disabled={!canGoForward}
          >
            <ArrowRightIcon className="size-3" />
          </WebPreviewNavigationButton>
        )}

        {title && (
          <div className="pl-2 flex gap-2">
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              {title}
            </span>
          </div>
        )}
        <WebPreviewNavigationButton onClick={handleReload} tooltip="Reload">
          <RefreshCcwIcon className="size-3" />
        </WebPreviewNavigationButton>
        <WebPreviewUrl className="h-6 text-xs" disabled={!editUrl} />
        <WebPreviewNavigationButton
          onClick={handleOpenInNewTab}
          tooltip="Open in new tab"
        >
          <ExternalLinkIcon className="size-3" />
        </WebPreviewNavigationButton>
        <WebPreviewNavigationButton
          onClick={handleToggleFullscreen}
          tooltip="Maximize"
        >
          <Maximize2Icon className="size-3" />
        </WebPreviewNavigationButton>
      </WebPreviewNavigation>

      <WebPreviewBody src={currentUrl} />

      <WebPreviewConsole logs={logs} />
    </WebPreview>
  );
}
