import { ThemeDialogContent } from "../dialogs";
import type { Command } from "./types";

export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Create",
    value: "/new",
    action: (ctx) => {
      ctx.toast.show({ message: "Starting new conversation ..." });
    },
  },
  {
    name: "upgrade",
    description: "Buy credits",
    value: "/upgrade",
    action: (ctx) => {
      ctx.toast.show({ message: "Opening credits checkout ..." });
    },
  },
  {
    name: "usage",
    description: "Billing",
    value: "/usage",
    action: (ctx) => {
      ctx.toast.show({ message: "Opening billing portal ..." });
    },
  },
  {
    name: "agents",
    description: "Switch agents",
    value: "/agents",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Mode",
        children: <text>Agent selection coming soon...</text>,
      });
    },
  },
  {
    name: "login",
    description: "Log-in",
    value: "/login",
    action: (ctx) => {
      ctx.toast.show({ message: "Opening browser to sign in ..." });
    },
  },
  {
    name: "logout",
    description: "Log-out",
    value: "/logout",
    action: (ctx) => {
      ctx.toast.show({ variant: "success", message: "Signed out" });
    },
  },
  {
    name: "sessions",
    description: "Browse",
    value: "/sessions",
    action: (ctx) => {
      ctx.toast.show({ message: "Loading sessions ..." });
    },
  },

  {
    name: "models",
    description: "Select AI model",
    value: "/models",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Model",
        children: <text>Model selection coming soon...</text>,
      });
    },
  },
  {
    name: "theme",
    description: "Color theme",
    value: "/theme",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Theme",
        children: <ThemeDialogContent/>
      })
    },
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
