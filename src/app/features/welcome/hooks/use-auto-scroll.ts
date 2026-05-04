import { useEffect, useRef, useState } from "react";

interface UseAutoScrollOptions {
  messages: unknown[];
  isLoading?: boolean;
  threshold?: number; // Distance from bottom (in pixels) to consider "near bottom"
}

/**
 * Custom hook for automatically scrolling to the bottom of a container
 * when new messages arrive or the container is resized.
 *
 * Only auto-scrolls if the user is already near the bottom to avoid
 * interrupting manual scrolling.
 */
export function useAutoScroll({
  messages,
  isLoading = false,
  threshold = 100,
}: UseAutoScrollOptions) {
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Check if user is near the bottom of the page
  const isNearBottom = () => {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;

    return documentHeight - (scrollTop + windowHeight) <= threshold;
  };

  // Scroll to bottom smoothly
  const scrollToBottom = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  };

  // Track user scroll behavior
  useEffect(() => {
    const handleScroll = () => {
      const nearBottom = isNearBottom();
      shouldAutoScrollRef.current = nearBottom;
      setShowScrollButton(!nearBottom);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  // Auto-scroll when messages change
  useEffect(() => {
    if (shouldAutoScrollRef.current && messages.length > 1) {
      // Small delay to ensure DOM has updated
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [messages, isLoading]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (shouldAutoScrollRef.current) {
        scrollToBottom();
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return { scrollAnchorRef, showScrollButton, scrollToBottom };
}
