import { Command } from "./types";

export const COMMANDS: Command[] = [
    {
        name: "new",
        description: "Create a new project",
        value: "/new"
    },
    {
        name: "exit",
        description: "Exit MaxIntel CLI",
        value: "/exit",
        action: (ctx) => { 
            ctx.exit();
        }
    }
]