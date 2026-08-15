import { readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { TextAttributes } from "@opentui/core";
import type { TextareaRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useRenderer, useKeyboard } from "@opentui/react";
import type { Command } from "./command-menu/types";
import { useCommandMenu } from "./command-menu/use-command-menu";
import type { KeyBinding } from "@opentui/core";
import { StatusBar } from "./status-bar";
import { EmptyBorder } from "./border";
import { CommandMenu } from "./command-menu";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { useNavigate } from "react-router";
import { usePromptConfig } from "../providers/prompt-config";
import { Mode } from "@maxintel/database/enums";

const MAX_VISIBLE_MENTIONS = 8;
const CURRENT_DIRECTORY = process.cwd();
const MAX_FALLBACK_MENTION_CANDIDATES = 32;
const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/;
const RECURSIVE_MENTION_IGNORED_DIRECTORIES = new Set(["node_modules"]);

type MentionMatch = {
  start: number;
  end: number;
  query: string;
};

type MentionCandidate = {
  path: string;
  kind: "file" | "directory";
};

function isWithinCurrentDirectory(targetPath: string) {
  const relativePath = relative(CURRENT_DIRECTORY, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isMentionQueryCharacter(character: string) {
  return MENTION_QUERY_CHARACTER.test(character);
}

function findActiveMention(
  text: string,
  cursorOffset: number,
): MentionMatch | null {
  const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));

  let start = safeOffset;
  while (start > 0 && !/\s/.test(text[start - 1]!)) {
    start -= 1;
  }

  let end = safeOffset;
  while (end < text.length && !/\s/.test(text[end]!)) {
    end += 1;
  }

  const token = text.slice(start, end);
  const relativeCursor = safeOffset - start;
  const mentionStart = token.lastIndexOf("@", relativeCursor);

  if (mentionStart === -1) return null;

  const previousCharacter = token[mentionStart - 1];
  if (previousCharacter && isMentionQueryCharacter(previousCharacter)) {
    return null;
  }

  let mentionEnd = mentionStart + 1;
  while (
    mentionEnd < token.length &&
    isMentionQueryCharacter(token[mentionEnd]!)
  ) {
    mentionEnd += 1;
  }

  if (relativeCursor < mentionStart || relativeCursor > mentionEnd) {
    return null;
  }

  return {
    start: start + mentionStart,
    end: start + mentionEnd,
    query: token.slice(mentionStart + 1, mentionEnd),
  };
}

async function getMentionCandidates(
  query: string,
): Promise<MentionCandidate[]> {
  const normalizedQuery = query.startsWith("./") ? query.slice(2) : query;

  // Absolute paths are out of scope
  if (normalizedQuery.startsWith("/")) {
    return [];
  }

  const hasTrailingSlash = normalizedQuery.endsWith("/");
  const lastSlashIndex = hasTrailingSlash
    ? normalizedQuery.length - 1
    : normalizedQuery.lastIndexOf("/");

  const directoryPart = hasTrailingSlash
    ? normalizedQuery.slice(0, -1)
    : lastSlashIndex === -1
      ? ""
      : normalizedQuery.slice(0, lastSlashIndex);

  const namePrefix = hasTrailingSlash
    ? ""
    : lastSlashIndex === -1
      ? normalizedQuery
      : normalizedQuery.slice(lastSlashIndex + 1);

  const absoluteDirectory = resolve(CURRENT_DIRECTORY, directoryPart || ".");

  if (!isWithinCurrentDirectory(absoluteDirectory)) {
    return [];
  }

  try {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const lowerPrefix = namePrefix.toLowerCase();
    const showHidden = namePrefix.startsWith(".");

    const matches = entries
      .filter((entry) => showHidden || !entry.name.startsWith("."))
      .filter((entry) => {
        // When prefix is empty (user typed .../src/), show everything
        if (lowerPrefix === "") return true;
        return entry.name.toLowerCase().startsWith(lowerPrefix);
      })
      // Skip heavy trees only at the top-level listing, not as matches
      .filter((entry) => {
        if (
          entry.isDirectory() &&
          RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name) &&
          directoryPart === ""
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Directories first, then files; alpha within each group
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const relativePath = directoryPart
          ? `${directoryPart}/${entry.name}`
          : entry.name;

        if (entry.isDirectory()) {
          return {
            path: `${relativePath}/`,
            kind: "directory" as const,
          };
        }

        return {
          path: relativePath,
          kind: "file" as const,
        };
      });

    // Direct listing is enough when we're inside a path or have a prefix
    if (matches.length > 0 || directoryPart !== "" || namePrefix === "") {
      return matches;
    }

    // Fallback: shallow recursive search by filename prefix from project root
    const fallback: MentionCandidate[] = [];

    const visit = async (absDir: string, relDir: string): Promise<void> => {
      let children;
      try {
        children = await readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of children) {
        if (!showHidden && entry.name.startsWith(".")) continue;
        if (
          entry.isDirectory() &&
          RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name)
        ) {
          continue;
        }

        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

        if (entry.name.toLowerCase().startsWith(lowerPrefix)) {
          fallback.push({
            path: entry.isDirectory() ? `${relPath}/` : relPath,
            kind: entry.isDirectory() ? "directory" : "file",
          });
          if (fallback.length >= MAX_FALLBACK_MENTION_CANDIDATES) return;
        }

        if (entry.isDirectory()) {
          await visit(resolve(absDir, entry.name), relPath);
          if (fallback.length >= MAX_FALLBACK_MENTION_CANDIDATES) return;
        }
      }
    };

    await visit(CURRENT_DIRECTORY, "");
    return fallback.sort((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
}

type FileMentionMenuProps = {
  candidates: MentionCandidate[];
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onSelect: (index: number) => void;
  onExecute: (index: number) => void;
};

function FileMentionMenu({
  candidates,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: FileMentionMenuProps) {
  const { colors } = useTheme();
  const visibleHeight = Math.min(candidates.length, MAX_VISIBLE_MENTIONS);

  if (candidates.length === 0) {
    return (
      <box paddingX={1}>
        <text attributes={TextAttributes.DIM}>
          No matching files or folders
        </text>
      </box>
    );
  }

  return (
    <scrollbox ref={scrollRef} height={visibleHeight}>
      {candidates.map((candidate, index) => {
        const isSelected = index === selectedIndex;
        return (
          <box
            key={candidate.path}
            flexDirection="row"
            paddingX={1}
            height={1}
            overflow="hidden"
            backgroundColor={isSelected ? colors.selection : undefined}
            onMouseMove={() => onSelect(index)}
            onMouseDown={() => onExecute(index)}
          >
            <box flexGrow={1} flexShrink={1} overflow="hidden">
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {candidate.path}
              </text>
            </box>
            <box width={8} alignItems="flex-end" flexShrink={0}>
              <text selectable={false} fg={isSelected ? "black" : "gray"}>
                {candidate.kind === "directory" ? "Folder" : "File"}
              </text>
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
}

type Props = {
  onSubmit: (value: string) => void;
  disabled?: boolean;
};

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "enter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "enter", shift: true, action: "newline" },
];

export function InputBar({ onSubmit, disabled }: Props) {
  const { mode, toggleMode, setMode, setModel } = usePromptConfig();
  const textareaRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
  const activeMentionRef = useRef<MentionMatch | null>(null);
  const mentionScrollRef = useRef<ScrollBoxRenderable>(null);
  const renderer = useRenderer();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { isTopLayer, setResponder, push, pop } = useKeyboardLayer();
  const { colors } = useTheme();

  const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<
    MentionCandidate[]
  >([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  const {
    showCommandMenu,
    commandQuery,
    selectedIndex,
    scrollRef,
    handleContentChange,
    resolveCommand,
    setSelectedIndex,
  } = useCommandMenu();

  const showMentionMenu = activeMention !== null;

  const closeMentionMenu = useCallback(() => {
    activeMentionRef.current = null;
    setActiveMention(null);
    setMentionCandidates([]);
    pop("mention");
  }, [pop]);

  const syncMentionMenu = useCallback(
    (text: string, cursorOffset: number) => {
      const nextMention = findActiveMention(text, cursorOffset);
      const previousMention = activeMentionRef.current;

      if (!nextMention) {
        if (previousMention) closeMentionMenu();
        return;
      }

      activeMentionRef.current = nextMention;
      setActiveMention(nextMention);

      push("mention", () => {
        closeMentionMenu();
        return true;
      });

      if (
        previousMention?.start !== nextMention.start ||
        previousMention?.end !== nextMention.end ||
        previousMention?.query !== nextMention.query
      ) {
        setMentionSelectedIndex(0);
        mentionScrollRef.current?.scrollTo(0);
      }
    },
    [closeMentionMenu, push],
  );

  const handleCommand = useCallback(
    (command: Command | undefined) => {
      const textarea = textareaRef.current;
      if (!textarea || !command) return;

      textarea.setText("");
      if (command.action) {
        command.action({
          exit: () => renderer.destroy(),
          toast,
          dialog,
          navigate,
          mode,
          setMode,
          setModel,
        });
      } else {
        textarea.insertText(command.value + " ");
      }
    },
    [renderer, toast, dialog, navigate, mode, setMode, setModel],
  );

  const handleCommandExecute = useCallback(
    (indexOrId: string | number) => {
      const index =
        typeof indexOrId === "string" ? Number(indexOrId) : indexOrId;
      handleCommand(resolveCommand(index));
    },
    [resolveCommand, handleCommand],
  );

  const handleTextareaContentChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    handleContentChange(textarea.plainText);
    syncMentionMenu(textarea.plainText, textarea.cursorOffset);
  }, [handleContentChange, syncMentionMenu]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = textarea.plainText.trim();
    if (text.length === 0) return;
    onSubmit(text);
    textarea.setText("");
  }, [disabled, onSubmit]);

  const handleMentionExecute = useCallback(
    (index: number) => {
      const textarea = textareaRef.current;
      const mention = activeMentionRef.current;
      const candidate = mentionCandidates[index];
      if (!textarea || !mention || !candidate) return;

      const insertion = candidate.path;
      const nextText = `${textarea.plainText.slice(0, mention.start)}@${insertion}${textarea.plainText.slice(mention.end)}`;

      textarea.replaceText(nextText);
      textarea.cursorOffset = mention.start + insertion.length + 1;
      syncMentionMenu(nextText, textarea.cursorOffset);
    },
    [mentionCandidates, syncMentionMenu],
  );

  useEffect(() => {
    if (!activeMention) {
      setMentionCandidates([]);
      return;
    }

    let ignore = false;

    const loadCandidates = async () => {
      const nextCandidates = await getMentionCandidates(activeMention.query);
      if (ignore) return;

      setMentionCandidates(nextCandidates);
      setMentionSelectedIndex((current) =>
        nextCandidates.length === 0
          ? 0
          : Math.min(current, nextCandidates.length - 1),
      );
    };

    void loadCandidates();

    return () => {
      ignore = true;
    };
  }, [activeMention]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.onSubmit = () => onSubmitRef.current();
  }, []);

  onSubmitRef.current = () => {
    if (disabled) return;

    if (showCommandMenu) {
      handleCommand(resolveCommand(selectedIndex));
      return;
    }

    if (showMentionMenu) {
      const candidate = mentionCandidates[mentionSelectedIndex];
      if (candidate) {
        handleMentionExecute(mentionSelectedIndex);
        return;
      }
    }

    handleSubmit();
  };

  useKeyboard((key) => {
    if (disabled) return;
    if (!isTopLayer("base")) return;
    if (key.name === "tab") key.preventDefault();
    toggleMode();
  });

  useEffect(() => {
    setResponder("base", () => {
      if (disabled) return false;
      const textarea = textareaRef.current;
      if (textarea && textarea.plainText.length > 0) {
        textarea.setText("");
        return true;
      }
      return false;
    });
    return () => setResponder("base", null);
  }, [disabled, setResponder]);

  useKeyboard((key) => {
    if (disabled) return;
    if (!showMentionMenu || !isTopLayer("mention")) return;

    if (key.name === "escape") {
      key.preventDefault();
      closeMentionMenu();
    } else if (key.name === "up") {
      key.preventDefault();
      setMentionSelectedIndex((current) => {
        const next = Math.max(0, current - 1);
        const scrollbox = mentionScrollRef.current;
        if (scrollbox && next < scrollbox.scrollTop) {
          scrollbox.scrollTo(next);
        }
        return next;
      });
    } else if (key.name === "down") {
      key.preventDefault();
      setMentionSelectedIndex((current) => {
        if (mentionCandidates.length === 0) return 0;
        const next = Math.min(mentionCandidates.length - 1, current + 1);
        const scrollbox = mentionScrollRef.current;
        if (scrollbox) {
          const viewportHeight = scrollbox.viewport.height;
          const visibleEnd = scrollbox.scrollTop + viewportHeight - 1;
          if (next > visibleEnd) {
            scrollbox.scrollTo(next - viewportHeight + 1);
          }
        }
        return next;
      });
    }
  });

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={mode === Mode.BUILD ? colors.primary : colors.planMode}
        customBorderChars={{
          ...EmptyBorder,
          vertical: "│",
          bottomLeft: "╵",
        }}
      >
        <box
          width="100%"
          position="relative"
          gap={1}
          paddingX={2}
          paddingY={1}
          justifyContent="center"
          backgroundColor={colors.surface}
        >
          {showCommandMenu && (
            <box
              position="absolute"
              bottom="100%"
              left={0}
              width="100%"
              backgroundColor={colors.surface}
              zIndex={10}
            >
              <CommandMenu
                query={commandQuery}
                selectedIndex={selectedIndex}
                scrollRef={scrollRef}
                onSelect={(command) => setSelectedIndex(Number(command))}
                onExecute={handleCommandExecute}
              />
            </box>
          )}

          {!showCommandMenu && showMentionMenu && (
            <box
              position="absolute"
              bottom="100%"
              left={0}
              width="100%"
              backgroundColor={colors.surface}
              zIndex={10}
            >
              <FileMentionMenu
                candidates={mentionCandidates}
                selectedIndex={mentionSelectedIndex}
                scrollRef={mentionScrollRef}
                onSelect={setMentionSelectedIndex}
                onExecute={handleMentionExecute}
              />
            </box>
          )}

          <textarea
            ref={textareaRef}
            focused={
              !disabled &&
              (isTopLayer("base") ||
                isTopLayer("command") ||
                isTopLayer("mention"))
            }
            keyBindings={TEXTAREA_KEY_BINDINGS}
            onContentChange={handleTextareaContentChange}
            placeholder="Ask anything... e.g. Fix the bug in the script"
          />
          <StatusBar />
        </box>
      </box>
    </box>
  );
}
