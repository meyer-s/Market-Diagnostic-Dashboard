import {
  cloneElement,
  useId,
  type ReactElement,
} from "react";

type FormControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
};

type FormFieldProps = {
  label: string;
  children: ReactElement<FormControlProps>;
  id?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

export default function FormField({
  label,
  children,
  id,
  hint,
  error,
  required = false,
  className = "",
}: FormFieldProps) {
  const generatedId = useId().replace(/:/g, "");
  const controlId = id ?? children.props.id ?? `field-${generatedId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [
    children.props["aria-describedby"],
    hintId,
    errorId,
  ].filter(Boolean).join(" ") || undefined;

  const control = cloneElement(children, {
    id: controlId,
    required: required || children.props.required,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : children.props["aria-invalid"],
    "aria-required": required || children.props["aria-required"],
  });

  return (
    <div className={`form-field ${className}`.trim()}>
      <label className="form-field-label" htmlFor={controlId}>
        {label}
        {required ? <span className="form-field-required" aria-hidden="true">Required</span> : null}
      </label>
      {control}
      {hint ? <p id={hintId} className="form-field-hint">{hint}</p> : null}
      {error ? <p id={errorId} className="form-field-error" role="alert">{error}</p> : null}
    </div>
  );
}
