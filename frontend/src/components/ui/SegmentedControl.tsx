export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  className?: string;
};

export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`segmented-control ${className}`.trim()}
      role="group"
      aria-label={label}
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
