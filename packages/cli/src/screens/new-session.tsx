import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { BotMessage, ErrorMessage, UserMessage } from "../components/messages";
import { SessionShell } from "../components/session-shell";

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as { message?: string } | null;
  useEffect(() => {
    if (!state?.message) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);
  if (!state?.message) return null;
  return (
    <SessionShell onSubmit={() => {}} inputDisbled loading>
      <UserMessage message={state.message} />
      <BotMessage content="Sample bot response" model="Maxintel" />
      <ErrorMessage message="Sample error message" />
    </SessionShell>
  );
}
