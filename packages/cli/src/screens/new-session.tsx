import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { modeSchema } from "@maxintel/shared";
import { useNavigate, useLocation } from "react-router";
import { UserMessage } from "../components/messages";
import { SessionShell } from "../components/session-shell";
import { useToast } from "../providers/toast";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";

const newSessionStateSchema = z.object({
  message: z.string(),
  mode: modeSchema,
  model: z.string(),
});

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const hasStartedRef = useRef(false);

  const state = useMemo(() => {
    const parsed = newSessionStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);
  useEffect(() => {
    if (!state?.message) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);
  useEffect(() => {
    if (!state?.message) {
      navigate("/", { replace: true });
    }
  }, [state, navigate]);
  useEffect(() => {
    if (!state || hasStartedRef.current) return;
    hasStartedRef.current = true;
    let ignore = false;

    const createSession = async () => {
      try {
        const res = await apiClient.sessions.$post({
          json: {
            title: state.message.slice(0, 100),        
          },
        });
        if (ignore) return;
        if (!res.ok) {
          throw new Error(await getErrorMessage(res));
        }
        const session = await res.json();
        navigate("/sessions/${sessionId}", {
          replace: true,
          state: {
            session, initialPrompt: state
          },
        });
      } catch (error) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            error instanceof Error ? error.message : "Failed to create session",
        });
        navigate("/", { replace: true });
      }
    };
    createSession();
    return () => {
      ignore = true;
    };
  }, [state, navigate, toast]);
  if (!state?.message) return null;
  return (
    <SessionShell onSubmit={() => {}} loading>
      <UserMessage message={state.message} mode={state.mode} />
    </SessionShell>
  );
}
