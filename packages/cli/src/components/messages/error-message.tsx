import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import { TextAttributes } from "@opentui/core";

const ERROR_BORDER = {
  ...EmptyBorder(),
  vertical: "│",
  bottomLeft: "╵",
} as const;

type Props = {
  message: string;
};

export function ErrorMessage({ message }: Props) {
  const { colors } = useTheme();

  return (
    <box
      width="100%"
      border={["left"]}
      borderColor={colors.error}
      backgroundColor={colors.surface}
      paddingX={2}
      paddingY={1}
      alignItems="center"
      customBorderChars={ERROR_BORDER}
    >
      <text attributes={TextAttributes.DIM}>{message}</text>
    </box>
  );
}
