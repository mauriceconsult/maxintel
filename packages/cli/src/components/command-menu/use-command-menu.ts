import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Command } from "./types";
import { getFilteredCommands } from "./filter-commands";
import { useKeyboardLayer } from "../../providers/keyboard-layer";

import type { RefObject } from "react";

type UseCommandMenuReturn = {
  showCommandMenu: boolean;
  commandQuery: string;
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  handleContentChange: (text: string) => void;
  resolveCommand: (index: number) => Command | undefined;
  setSelectedIndex: (index: number) => void;
  close: () => void;
};

export function useCommandMenu(): UseCommandMenuReturn {
  const [textValue, setTextValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const { push, pop, isTopLayer } = useKeyboardLayer();

  const showCommandMenu =
    textValue.startsWith("/") && !textValue.slice(1).includes(" ");

  const commandQuery = showCommandMenu ? textValue.slice(1) : "";

  const filteredCommands = useMemo(
    () => getFilteredCommands(commandQuery),
    [commandQuery],
  );

  // close() only clears text. When textValue changes, showCommandMenu
  // becomes false, which triggers the useEffect cleanup below to pop the
  // layer. No manual pop needed — and no double-pop possible.
  const close = useCallback(() => {
    setTextValue("");
    setSelectedIndex(0);
  }, []);

  const handleContentChange = useCallback((text: string) => {
    setTextValue(text);
    setSelectedIndex(0);
  }, []);

  // Scroll to keep selected item visible
  useEffect(() => {
    scrollRef.current?.scrollTo(selectedIndex);
  }, [selectedIndex]);

  // Push layer when menu opens; cleanup pops it when menu closes.
  // Nothing else — no close() calls here.
  useEffect(() => {
    if (!showCommandMenu) return;
    push("command");
    return () => pop("command");
  }, [showCommandMenu, push, pop]);

  const resolveCommand = useCallback(
    (index: number): Command | undefined => filteredCommands[index],
    [filteredCommands],
  );

  useKeyboard((key) => {
    if (!showCommandMenu || !isTopLayer("command")) return;

    switch (key.name) {
      case "up":
        setSelectedIndex((i) => Math.max(0, i - 1));
        break;

      case "down":
        setSelectedIndex((i) => Math.min(filteredCommands.length - 1, i + 1));
        break;

      case "escape":
        close(); // the only correct place for close()
        break;

      default:
        break;
    }
  });

  return {
    showCommandMenu,
    commandQuery,
    selectedIndex,
    scrollRef,
    handleContentChange,
    resolveCommand,
    setSelectedIndex,
    close, // exposed so parent can call close() after executing a command
  };
}
