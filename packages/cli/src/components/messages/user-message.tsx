import { EmptyBorder } from "../border";
import { useTheme } from "../../providers/theme";

const USER_BORDER = {
  ...EmptyBorder(),
  vertical: "│",
  bottomLeft: "╵",
} as const;

type Props = {
  message: string;
};

export function UserMessage({ message }: Props) {
  const { colors } = useTheme();

  return (
    <box
      width="100%"
      border={["left"]}
      borderColor={colors.primary}
      backgroundColor={colors.surface}
      paddingX={2}
      paddingY={1}
      alignItems="center"
      customBorderChars={USER_BORDER}
    >
      <text>{message}</text>
    </box>
  );
}
