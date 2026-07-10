export type ThemeColors = {
  primary: string;
  planMode: string;
  selection: string;
  thinking: string;
  success: string;
  error: string;
  info: string;
  background: string;
  surface: string;
  dialogSurface: string;
  thinkingBorder: string;
  dimSeparator: string;
};
export type Theme = {
  name: string;
  colors: ThemeColors;
};
export const THEMES: Theme[] = [
  {
    name: "Maxintel",
    colors: {
      primary: "#56D6C2",
      planMode: "#CF8EF4",
      selection: "#8984FA",
      thinking: "#CF8EF4",
      success: "#82E0AA",
      error: "#E74C5E",
      info: "#56D6C2",
      background: "#0D0D12",
      surface: "#1A1A24",
      dialogSurface: "#0A0A10",
      thinkingBorder: "#34344A",
      dimSeparator: "#4E4E66",
    },
  },
  {
    name: "Soft Midnight",
    colors: {
      primary: "#60A5FA",
      planMode: "#F9A8D4",
      selection: "#93C5FD",
      thinking: "#F9A8D4",
      success: "#6EE787",
      error: "#FCA5A5",
      info: "#67E8F9",
      background: "#0F172A",
      surface: "#1E293B",
      dialogSurface: "#0C1322",
      thinkingBorder: "#334155",
      dimSeparator: "#475569",
    },
  },
  {
    name: "Emerald Forest",
    colors: {
      primary: "#34D399",
      planMode: "#A7F3D0",
      selection: "#6EE7B7",
      thinking: "#10B981",
      success: "#4ADE80",
      error: "#F87171",
      info: "#2DD4BF",
      background: "#071A12",
      surface: "#0F2A20",
      dialogSurface: "#0A1E17",
      thinkingBorder: "#14532D",
      dimSeparator: "#355E52",
    },
  },
  {
    name: "Solar Flare",
    colors: {
      primary: "#F59E0B",
      planMode: "#FBBF24",
      selection: "#FCD34D",
      thinking: "#FB923C",
      success: "#84CC16",
      error: "#EF4444",
      info: "#FDE68A",
      background: "#1A1208",
      surface: "#2A1C10",
      dialogSurface: "#120C05",
      thinkingBorder: "#78350F",
      dimSeparator: "#7C5A2E",
    },
  },
  {
    name: "Cyber Neon",
    colors: {
      primary: "#00F5FF",
      planMode: "#FF00C8",
      selection: "#7C3AED",
      thinking: "#C026D3",
      success: "#22C55E",
      error: "#FF4D6D",
      info: "#38BDF8",
      background: "#05060A",
      surface: "#11131A",
      dialogSurface: "#090B10",
      thinkingBorder: "#2A2D3A",
      dimSeparator: "#4B5563",
    },
  },
  {
    name: "Royal Amethyst",
    colors: {
      primary: "#A78BFA",
      planMode: "#C084FC",
      selection: "#DDD6FE",
      thinking: "#8B5CF6",
      success: "#4ADE80",
      error: "#FB7185",
      info: "#93C5FD",
      background: "#140F1F",
      surface: "#221A33",
      dialogSurface: "#110C19",
      thinkingBorder: "#4C1D95",
      dimSeparator: "#5B4B73",
    },
  },
];
function getTheme(name: string): Theme {
  return THEMES.find((t) => t.name === name) ?? THEMES[0]!;
}

export const DEFAULT_THEME = getTheme("Maxintel");