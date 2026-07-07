export function Header() {
  return (
    <box
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
    >
      <box
        flexDirection="row"
        justifyContent="center"
        gap={0.5}
        alignItems="flex-end"
      >
        <ascii-font font="tiny" text="Maxintel" color="gray" />
        <ascii-font font="tiny" text="code" />
      </box>
    </box>
  );
}