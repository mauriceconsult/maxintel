import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";
import { Mode } from "@maxintel/database/enums";

const USER_BORDER = {
  ...EmptyBorder,
  vertical: "│",
  bottomLeft: "╵",
} as const;

type Props = {
  message: string;
  mode: Mode;
};

export function UserMessage({ message, mode }: Props) {
  const { colors } = useTheme();

  return (
    <box
      width="100%"
      border={["left"]}
      borderColor={colors.primary}
      backgroundColor={mode === Mode.PLAN ? colors.planMode : colors.primary}
      paddingX={2}
      paddingY={1}
      alignItems="center"
      customBorderChars={USER_BORDER}
    >
      <text>{message}</text>
    </box>
  );
}
