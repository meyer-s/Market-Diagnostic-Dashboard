import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusMode } from "../context/FocusModeContext";

export type ProgressiveCommitmentState = "rest" | "focus" | "expanded";

type ProgressiveCommitmentMode = "inline" | "navigate";

interface ProgressiveCommitmentOptions {
  mode?: ProgressiveCommitmentMode;
  onCommit?: () => void;
}

export const useProgressiveCommitment = (
  options: ProgressiveCommitmentOptions = {}
) => {
  const { mode = "inline", onCommit } = options;
  const { focusAll } = useFocusMode();
  const [isFocused, setIsFocused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const lastPointerType = useRef<string | null>(null);

  const collapse = useCallback(() => {
    setIsFocused(false);
    if (mode === "inline") {
      setIsExpanded(false);
    }
  }, [mode]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        collapse();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [collapse]);

  const handleCommit = useCallback(() => {
    if (mode === "navigate") {
      onCommit?.();
      return;
    }
    setIsExpanded((prev) => !prev);
  }, [mode, onCommit]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    lastPointerType.current = event.pointerType;
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (lastPointerType.current === "touch") return;
    setIsFocused(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (lastPointerType.current === "touch") return;
    setIsFocused(false);
  }, []);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(
    (event: React.FocusEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.relatedTarget as Node)) return;
      collapse();
    },
    [collapse]
  );

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const isTouch = lastPointerType.current === "touch";
      if (isTouch && !isFocused) {
        event.preventDefault();
        event.stopPropagation();
        setIsFocused(true);
        return;
      }
      handleCommit();
    },
    [handleCommit, isFocused]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleCommit();
    },
    [handleCommit]
  );

  const state = useMemo<ProgressiveCommitmentState>(() => {
    if (mode === "inline" && isExpanded) return "expanded";
    if (focusAll || isFocused) return "focus";
    return "rest";
  }, [focusAll, isExpanded, isFocused, mode]);
  const isTouchFocus = (focusAll || isFocused) && lastPointerType.current === "touch";

  const getContainerProps = useCallback(
    <T extends HTMLElement>() => ({
      ref: containerRef as React.RefObject<T>,
      onPointerDown: handlePointerDown,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      tabIndex: 0,
      role: "button",
    }),
    [
      handleBlur,
      handleClick,
      handleFocus,
      handleKeyDown,
      handleMouseEnter,
      handleMouseLeave,
      handlePointerDown,
    ]
  );

  return {
    state,
    isFocused,
    isExpanded,
    setIsExpanded,
    isTouchFocus,
    getContainerProps,
  };
};
