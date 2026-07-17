import { SUPPORTED_CHAT_MODELS } from "@maxintel/shared";
import { AgentsDialogContent, ModelsDialogContent, SessionsDialogContent, ThemeDialogContent } from "../dialogs";
import type { Command } from "./types";

export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Start a new conversation",
    value: "/new",
    action: (ctx) => {
      ctx.navigate("/");
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
        title: "Select Agent",
        children: (
          <AgentsDialogContent
            currentMode={ctx.mode}
            onSelectMode={ctx.setMode}
          />
        ),
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
      ctx.dialog.open({
        title: "Sessions",
        children: <SessionsDialogContent />,
      });
    },
  },

  {
    name: "models",
    description: "Select AI model",
    value: "/models",
    action: (ctx) => {
      ctx.dialog.open({
        title: "Select Model",
        children: (
          <ModelsDialogContent
            models={SUPPORTED_CHAT_MODELS.map((model) => model.id)}
            onSelectModel={ctx.setModel}
          />
        ),
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
        children: <ThemeDialogContent />,
      });
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
