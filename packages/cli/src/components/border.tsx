import type { BorderCharacters } from "@opentui/core";

export const EmptyBorder: BorderCharacters = {
  topLeft: "",
  topRight: "",
  bottomLeft: "",
  bottomRight: "",
  vertical: "",
  horizontal: "",
  leftT: "",
  rightT: "",
  topT: "",
  bottomT: "",
  cross: "",
};

/** @deprecated use EmptyBorder */
export const splitBorderChars = EmptyBorder;
