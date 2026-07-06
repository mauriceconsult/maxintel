// packages/cli/src/opentui.d.ts
// Manual type declarations for @opentui/react intrinsic elements.
// Remove once @opentui/react ships its own jsx-runtime types.

import "@opentui/react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      box: {
        alignItems?: string;
        justifyContent?: string;
        flexGrow?: number;
        flexDirection?: string;
        width?: number | string;
        height?: number | string;
        children?: React.ReactNode;
        [key: string]: unknown;
      };
      text: {
        attributes?: number;
        children?: React.ReactNode;
        [key: string]: unknown;
      };
      "ascii-font": {
        font?: string;
        text?: string;
        [key: string]: unknown;
      };
    }
  }
}
