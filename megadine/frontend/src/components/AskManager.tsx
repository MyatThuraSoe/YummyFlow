import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAskManager, type ApprovalKind } from "../hooks/useAskManager";

/**
 * Shared "Ask manager" control for the POS override dialogs. A granted
 * approval id is passed back to the caller, which attaches it to the real
 * action. No manager PIN is ever shown or typed on this device.
 */
export function AskManager({
  action,
  amount,
  reason,
  payload,
  disabled,
  onApproval,
}: {
  action: ApprovalKind;
  amount?: number | null;
  reason: string;
  payload?: unknown;
  disabled?: boolean;
  onApproval: (approvalId: string | null) => void;
}) {
  const { t } = useTranslation(["ops", "common"]);
  const { status, message, approvalId, ask, reset } = useAskManager(t);

  useEffect(() => {
    onApproval(status === "approved" ? approvalId : null);
  }, [status, approvalId, onApproval]);

  const tone = status === "approved" ? "ok" : status === "waiting" ? "warn" : "danger";

  return (
    <div className="stack" style={{ gap: 4 }}>
      <button
        type="button"
        className="btn small"
        disabled={disabled || !reason.trim() || status === "waiting" || status === "approved"}
        onClick={() => void ask({ action, amount, reason, payload })}
      >
        {t("ops:ask_manager", { defaultValue: "Ask manager" })}
      </button>
      {status !== "idle" && <span className={`badge ${tone}`}>{message}</span>}
      {(status === "refused" || status === "expired" || status === "error") && (
        <button type="button" className="btn small ghost" onClick={reset}>
          {t("ops:ask_again", { defaultValue: "Ask again" })}
        </button>
      )}
    </div>
  );
}
