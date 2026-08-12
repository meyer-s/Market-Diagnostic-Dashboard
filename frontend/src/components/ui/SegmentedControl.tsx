export type SegmentedControlOption<T extends string | number> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string | number> = {
  label: string;
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  accent?: "neutral" | "sky" | "orange" | "emerald";
  className?: string;
};

export default function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  accent = "neutral",
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`segmented-control ${className}`.trim()}
      role="group"
      aria-label={label}
      data-accent={accent}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className="segmented-control-option"
            aria-pressed={selected}
            data-selected={selected ? "true" : "false"}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
