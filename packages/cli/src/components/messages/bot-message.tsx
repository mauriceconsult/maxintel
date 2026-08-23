import { Mode, type ModeType } from "@maxintel/shared";
import type { Message } from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";
import { TextAttributes } from "@opentui/core";
import type { BorderCharacters } from "@opentui/core";
import { EmptyBorder } from "../border";
import prettyMs from "pretty-ms";

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<
  ClientMessagePart,
  { type: `tool-${string}` | "dynamic-tool" }
>;

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: ModeType;
  durationMs?: number;
  streaming?: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatToolName(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function formatToolArgs(tc: ToolPart): string {
  if (!("input" in tc) || tc.input === null) return "";
  if (typeof tc.input !== "object") return String(tc.input);
  return Object.values(tc.input).map(String).join(" ");
}

// Full BorderCharacters object — satisfies the required type.
// EmptyBorder is Partial so spreading alone leaves missing fields.
const LEFT_PIPE: BorderCharacters = {
  ...EmptyBorder,
  vertical: "|",
} as BorderCharacters;

// ── Part grouping ─────────────────────────────────────────────────────────────

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
    } else {
      const key = isToolPart(part)
        ? `group-tc-${part.toolCallId}`
        : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
    }
  }

  return groups;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BotMessage({ parts, mode, model, durationMs }: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" alignItems="center">
      {groupConsecutiveParts(parts).map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            // ── Text part ─────────────────────────────────────────────────────
            if (part.type === "text") {
              return (
                <box key={`text-${j}`} paddingX={3} width="100%">
                  <text>{part.text}</text>
                </box>
              );
            }

            // ── Tool-call part ────────────────────────────────────────────────
            if (isToolPart(part)) {
              const toolName =
                part.type === "dynamic-tool"
                  ? part.toolName
                  : part.type.slice("tool-".length);
              const args = formatToolArgs(part); // ← was declared but never read
              return (
                <box
                  key={part.toolCallId}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={LEFT_PIPE}
                  width="100%"
                  paddingX={2}
                >
                  <text>
                    <em>{formatToolName(toolName)}</em>
                    {args ? ` ${args}` : ""}
                    {part.state !== "output-available" &&
                    part.state !== "output-error"
                      ? " ..."
                      : ""}
                    {part.state === "output-error" ? `${part.errorText}` : ""}
                  </text>
                </box>
              );
            }

            // ── Reasoning part ────────────────────────────────────────────────
            if (part.type === "reasoning") {
              return (
                <box
                  key={`reasoning-${j}`}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={LEFT_PIPE}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking</em> {part.text}
                  </text>
                </box>
              );
            }
            
            return null;
          })}
        </box>
      ))}

      {/* ── Footer: mode / model / duration ─────────────────────────────── */}
      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
            ◉
          </text>

          <box flexDirection="row" gap={1}>
            <text>{mode === Mode.PLAN ? "Plan" : "Build"}</text>

            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>

            {durationMs != null && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {prettyMs(durationMs)}
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}
