import "opentui-spinner/react";
import { useTheme } from "../providers/theme";
import { Mode, type ModeType } from "@maxintel/shared";

type Props = {
  mode?: ModeType;
};

export function Spinner({mode = Mode.BUILD}: Props) {
    const { colors } = useTheme();
    const activeColor = mode === Mode.PLAN ? colors.planMode : colors.primary;
    return<spinner name="aesthetic" color={activeColor}/>
}