import type { TFunction } from "i18next";
import { ApiError } from "./api";

export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    return t(`errors:${err.code}`, { defaultValue: "" }) || err.message;
  }
  if (err instanceof Error) return err.message;
  return t("errors:generic");
}
