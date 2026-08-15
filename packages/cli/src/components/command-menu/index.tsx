// import { ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { COMMANDS } from "./commands";
import { getFilteredCommands } from "./filter-commands";
import { useTheme } from "../../providers/theme";


const MAX_VISIBLE_ITEMS = 8;
const COMMAND_COL_WIDTH = Math.max(...COMMANDS.map((cmd) => cmd.name.length)) + 4;  

type CommandMenuProps = {
  query: string;
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    onSelect: (command: string) => void;
  onExecute: (command: string) => void;
};
export function CommandMenu({ query, selectedIndex, scrollRef, onSelect, onExecute }: CommandMenuProps) {
  const {colors} = useTheme()
    const filteredCommands = getFilteredCommands(query);
    const visibleHeight = Math.min(filteredCommands.length, MAX_VISIBLE_ITEMS);
    
    if (filteredCommands.length === 0) {
        return (
            <box paddingX={1}>
                <text attributes={TextAttributes.DIM}>
                    No commands found for "{query}"
                </text>
            </box>
        )
    }
    return (
      <scrollbox ref={scrollRef} height={visibleHeight}>
        {filteredCommands.map((cmd, index) => {
          const isSelected = index === selectedIndex;
          return (
            <box
              key={cmd.name}
              flexDirection="row"
              paddingX={1}
              height={1}
              overflow="hidden"
              backgroundColor={isSelected ? colors.selection : undefined}
              onMouseMove={() => onSelect(cmd.name)}
              onMouseDown={() => onExecute(cmd.name)}
            >
              {/* Name column — fixed width */}
              <box width={COMMAND_COL_WIDTH} flexShrink={0}>
                <text selectable={false} fg={isSelected ? "black" : "white"}>
                  /{cmd.name}
                </text>
              </box>

              {/* Description column — separate, can truncate independently */}
              <box flexGrow={1} flexShrink={1} overflow="hidden">
                <text
                  selectable={false}
                  fg={isSelected ? "black" : "gray"}
                  attributes={TextAttributes.DIM}
                >
                  {cmd.description}
                </text>
              </box>
            </box>
          );
        })}
      </scrollbox>
    );
}
