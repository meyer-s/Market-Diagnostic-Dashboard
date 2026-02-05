import type { UpdateStatus } from "../../types/updates";

export const UPDATE_STATUS_STYLES: Record<
  UpdateStatus,
  { pill: string; text: string; chip: string; chipActive: string }
> = {
  GREEN: {
    pill: "bg-emerald-500/15 border border-emerald-500/35 text-emerald-300",
    text: "text-emerald-300",
    chip: "border border-emerald-500/30 text-emerald-300/80 hover:text-emerald-200 hover:border-emerald-400/40",
    chipActive: "bg-emerald-500/20 border border-emerald-400/50 text-emerald-200",
  },
  YELLOW: {
    pill: "bg-amber-500/15 border border-amber-500/35 text-amber-200",
    text: "text-amber-200",
    chip: "border border-amber-500/30 text-amber-200/85 hover:text-amber-100 hover:border-amber-400/40",
    chipActive: "bg-amber-500/20 border border-amber-400/50 text-amber-100",
  },
  RED: {
    pill: "bg-rose-500/15 border border-rose-500/35 text-rose-200",
    text: "text-rose-200",
    chip: "border border-rose-500/30 text-rose-200/85 hover:text-rose-100 hover:border-rose-400/40",
    chipActive: "bg-rose-500/20 border border-rose-400/50 text-rose-100",
  },
};

export const formatUpdateDate = (value: string): string =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
