import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { apiGet, apiPost } from "../lib/api";
import { errorMessage } from "../lib/errors";

export type ApprovalKind = "DISCOUNT" | "VOID" | "REFUND" | "COMP" | "PRIORITY";
export type AskStatus = "idle" | "waiting" | "approved" | "refused" | "expired" | "error";

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

interface MineRequest {
  id: string;
  status: string;
  approver: { name: string } | null;
}

/**
 * "Ask manager": post an override request, then poll this device's requests
 * until a manager on another device decides. The PIN never crosses the floor.
 */
export function useAskManager(t: TFunction) {
  const [status, setStatus] = useState<AskStatus>("idle");
  const [message, setMessage] = useState("");
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const activeId = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      activeId.current = null;
    };
  }, []);

  function reset() {
    activeId.current = null;
    setStatus("idle");
    setMessage("");
    setApprovalId(null);
  }

  async function ask(input: {
    action: ApprovalKind;
    amount?: number | null;
    reason?: string;
    payload?: unknown;
  }) {
    try {
      const res = await apiPost<Envelope<{ request: { id: string } }>>("/approvals", input);
      const id = res.data.request.id;
      if (!alive.current) return;
      activeId.current = id;
      setApprovalId(id);
      setStatus("waiting");
      setMessage(t("ops:approval_waiting", { defaultValue: "Waiting for a manager…" }));

      const started = Date.now();
      const poll = async () => {
        if (!alive.current || activeId.current !== id) return;
        try {
          const list = await apiGet<Envelope<{ requests: MineRequest[] }>>("/approvals/mine");
          const found = list.data.requests.find((r) => r.id === id);
          if (found?.status === "APPROVED") {
            setStatus("approved");
            setMessage(t("ops:approval_granted", { defaultValue: "Approved — you can continue" }));
            return;
          }
          if (found?.status === "REFUSED") {
            setStatus("refused");
            setMessage(t("ops:approval_refused", { defaultValue: "The manager refused this request" }));
            return;
          }
          if (found?.status === "EXPIRED" || Date.now() - started > 15 * 60_000) {
            setStatus("expired");
            setMessage(t("ops:approval_expired", { defaultValue: "This request expired — ask again" }));
            return;
          }
        } catch {
          // A brief network drop must not abandon the request; keep polling.
        }
        window.setTimeout(() => void poll(), 2000);
      };
      window.setTimeout(() => void poll(), 1200);
    } catch (e) {
      if (!alive.current) return;
      setStatus("error");
      setMessage(errorMessage(e, t));
    }
  }

  return { status, message, approvalId, ask, reset };
}
