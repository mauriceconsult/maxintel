import { Mode } from "@maxintel/database/enums";
import type {
  ClientMessagePart,
  ClientToolCallPart,
} from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";
import { TextAttributes } from "@opentui/core";
import type { BorderCharacters } from "@opentui/core";
import { EmptyBorder } from "../border";

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: Mode;
  duration?: string;
  streaming?: boolean;
  interrupted?: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatToolName(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}


function formatToolArgs(tc: ClientToolCallPart): string {
  return Object.values(tc.args).map(String).join(" ");
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
      const key =
        part.type === "tool-call"
          ? `group-tc-${part.id}`
          : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
    }
  }

  return groups;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BotMessage({
  parts,
  mode,
  model,
  duration,
  interrupted = false,
}: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" alignItems="center">
      {groupConsecutiveParts(parts).map((group) => (
        <box key={group.key} paddingY={1} width="100%">
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
            if (part.type === "tool-call") {
              const args = formatToolArgs(part); // ← was declared but never read
              return (
                <box
                  key={part.id}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={LEFT_PIPE}
                  width="100%"
                  paddingX={2}
                >
                  <text>
                    <em>{formatToolName(part.name)}</em>
                    {args ? ` ${args}` : ""}
                    {part.status === "calling" ? " ..." : ""}
                  </text>
                </box>
              );
            }

            // ── Reasoning part ────────────────────────────────────────────────
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
          })}
        </box>
      ))}

      {/* ── Footer: mode / model / duration ─────────────────────────────── */}
      <box paddingX={3} paddingBottom={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text
            attributes={interrupted ? TextAttributes.DIM : 0}
            fg={
              interrupted
                ? undefined
                : mode === Mode.PLAN
                  ? colors.planMode
                  : colors.primary
            }
          >
            ◉
          </text>

          <box flexDirection="row" gap={1}>
            <text attributes={interrupted ? TextAttributes.DIM : 0}>
              {mode === Mode.PLAN ? "Plan" : "Build"}
            </text>

            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>

            {(duration || interrupted) && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {interrupted ? "interrupted" : duration}
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}
