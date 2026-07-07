import { useRef, useState, useMemo, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type { Command } from "./types";
import { getFilteredCommands } from "./filter-commands";

interface Scrollable {
  scrollTo(index: number): void;
}

interface Focusable {
  focus(): void;
}

interface Selectable<T> {
  select(value: T): void;
}

type UseCommandMenuReturn = {
  showCommandMenu: boolean;
  commandQuery: string;
  selectedIndex: number;
  scrollRef: ReturnType<typeof useRef<Scrollable | null>>;
  handleContentChange: (text: string) => void;
  resolveCommand: (index: number) => Command | undefined;
  setSelectedIndex: (index: number) => void;
};
export function useCommandMenu(): UseCommandMenuReturn {
 const [textValue, setTextValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const handleContentChange = (text: string) => {
    setTextValue(text);
    setSelectedIndex(0);
  };

 const showCommandMenu =
   textValue.startsWith("/") && !textValue.slice(1).includes(" ");

 const commandQuery = showCommandMenu ? textValue.slice(1) : "";

 const filteredCommands = useMemo(
   () => getFilteredCommands(commandQuery),
   [commandQuery],
 );

 const scrollRef = useRef<Scrollable | null>(null);

 useEffect(() => {
   scrollRef.current?.scrollTo(selectedIndex);
 }, [selectedIndex]);
 const resolveCommand = (index: number) => {
   const command = filteredCommands[index];

   if (!command) return undefined;

  

   return command;
    };
 useKeyboard((key) => {
   if (!showCommandMenu) return;

   switch (key.name) {
     case "up":
       setSelectedIndex((i) => Math.max(0, i - 1));
       break;

     case "down":
       setSelectedIndex((i) => Math.min(filteredCommands.length - 1, i + 1));
       break;

     case "escape":
       setTextValue("");
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
  };
}
