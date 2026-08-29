import { startMoMoTopUp, getCreditBalance } from "../../lib/upgrade";
import { SUPPORTED_CHAT_MODELS } from "@maxintel/shared";
import {
  AgentsDialogContent,
  ModelsDialogContent,
  SessionsDialogContent,
  ThemeDialogContent,
} from "../dialogs";
import type { Command } from "./types";
import { performLogin } from "../../lib/oauth";
import { clearAuth } from "../../lib/auth";

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
    description: "Top up credits with MTN MoMo",
    value: "/upgrade",
    action: async (ctx) => {
      ctx.toast.show({ message: "Opening MoMo checkout in your browser ..." });
      try {
        const session = await startMoMoTopUp();
        // The URL is shown as well as opened: `open` cannot do anything over
        // SSH or in a bare terminal, and the link is safe to copy — it carries
        // a short-lived signed token, not an API key.
        ctx.toast.show({
          message: [
            `${session.client}: ${session.balance.toLocaleString()} credits`,
            "Finish the MoMo top-up in your browser:",
            session.checkoutUrl,
          ].join("\n"),
        });
      } catch (err) {
        ctx.toast.show({
          variant: "error",
          message: err instanceof Error ? err.message : "Upgrade failed",
        });
      }
    },
  },
  {
    name: "usage",
    description: "Billing",
    value: "/usage",
    action: async (ctx) => {
      ctx.toast.show({ message: "Loading balance ..." });
      try {
        const { client, balance } = await getCreditBalance();
        ctx.toast.show({
          variant: balance > 0 ? "success" : "error",
          message:
            balance > 0
              ? `${client}: ${balance} credits`
              : `${client}: 0 credits — run /upgrade`,
        });
      } catch (err) {
        ctx.toast.show({
          variant: "error",
          message:
            err instanceof Error ? err.message : "Could not load balance",
        });
      }
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
    action: async (ctx) => {
      ctx.toast.show({ message: "Opening browser to sign in ..." });
      try {
        await performLogin();
        ctx.toast.show({ variant: "success", message: "Signed in" });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Sign in failed or timed out";
        ctx.toast.show({ variant: "error", message });
      }
    },
  },
  {
    name: "logout",
    description: "Log-out",
    value: "/logout",
    action: (ctx) => {
      clearAuth();
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
