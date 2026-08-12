import { useRef, type KeyboardEvent } from "react";

export type MarketTabOption<T extends string> = {
  value: T;
  label: string;
  panelId: string;
  tabId?: string;
  disabled?: boolean;
};

type MarketTabsProps<T extends string> = {
  label: string;
  value: T;
  options: Array<MarketTabOption<T>>;
  onChange: (value: T) => void;
  idPrefix: string;
  accent?: "sky" | "emerald";
  variant?: "underline" | "segmented";
  className?: string;
};

export default function MarketTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  idPrefix,
  accent = "sky",
  variant = "underline",
  className = "",
}: MarketTabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAndFocus = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    window.requestAnimationFrame(() => tabRefs.current[index]?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const enabledIndexes = options
      .map((option, index) => (option.disabled ? -1 : index))
      .filter((index) => index >= 0);
    if (enabledIndexes.length === 0) return;

    const enabledPosition = enabledIndexes.indexOf(currentIndex);
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = enabledIndexes[(enabledPosition + 1) % enabledIndexes.length];
    } else if (event.key === "ArrowLeft") {
      nextIndex = enabledIndexes[(enabledPosition - 1 + enabledIndexes.length) % enabledIndexes.length];
    } else if (event.key === "Home") {
      nextIndex = enabledIndexes[0];
    } else if (event.key === "End") {
      nextIndex = enabledIndexes[enabledIndexes.length - 1];
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    selectAndFocus(nextIndex);
  };

  return (
    <div
      className={`market-tabs market-tabs--${variant} ${className}`.trim()}
      role="tablist"
      aria-label={label}
      data-accent={accent}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={option.tabId ?? `${idPrefix}-${option.value}-tab`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={option.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            data-selected={selected ? "true" : "false"}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="market-tab"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
