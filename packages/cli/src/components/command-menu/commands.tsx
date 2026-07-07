import { Command } from "./types";

export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Create",
    value: "/new",
  },
  {
    name: "upgrade",
    description: "Buy credits",
    value: "/upgrade",
  },
  {
    name: "usage",
    description: "Bbilling",
    value: "/usage",
  },
  {
    name: "agents",
    description: "Switch agents",
    value: "/agents",
  },
  {
    name: "login",
    description: "Log-in",
    value: "/login",
  },
  {
    name: "logout",
    description: "Log-out",
    value: "/logout",
  },
  {
    name: "sessions",
    description: "Browse",
    value: "/sessions",
  },
  {
    name: "models",
    description: "Select AI model",
    value: "/models",
  },
  {
    name: "theme",
    description: "Color theme",
    value: "/theme",
  },
  {
    name: "exit",
    description: "Exit CLI",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },
  },
];
