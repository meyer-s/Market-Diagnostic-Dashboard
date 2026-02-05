import type { UpdateStatus } from "../../types/updates";
import { UPDATE_STATUS_STYLES } from "./updateStyles";

type StatusFilterValue = "ALL" | UpdateStatus;

interface StatusFilterChipsProps {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
}

const STATUS_OPTIONS: StatusFilterValue[] = ["ALL", "RED", "YELLOW", "GREEN"];

export default function StatusFilterChips({
  value,
  onChange,
}: StatusFilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_OPTIONS.map((option) => {
        const isActive = value === option;
        const baseClass =
          option === "ALL"
            ? isActive
              ? "bg-stealth-700 text-stealth-100 border border-stealth-500"
              : "border border-stealth-700 text-stealth-300 hover:text-stealth-100 hover:border-stealth-600"
            : isActive
              ? UPDATE_STATUS_STYLES[option].chipActive
              : UPDATE_STATUS_STYLES[option].chip;

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${baseClass}`}
          >
            {option === "ALL" ? "All" : option}
          </button>
        );
      })}
    </div>
  );
}
