export const CommandContext = {
    exit: () => void 0
};
export type Command = {
    name: string;
    description: string;
    value: string;
    action?: (ctx: typeof CommandContext) => void;
}