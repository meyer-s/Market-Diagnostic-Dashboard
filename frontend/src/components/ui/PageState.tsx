import type { ReactNode } from "react";

export type PageStateVariant =
  | "loading"
  | "error"
  | "empty"
  | "partial"
  | "stale"
  | "protected";

type PageStateProps = {
  variant: PageStateVariant;
  title: string;
  message: string;
  actions?: ReactNode;
  details?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2 | 3;
};

const liveRoleByVariant: Record<PageStateVariant, "alert" | "status"> = {
  loading: "status",
  error: "alert",
  empty: "status",
  partial: "status",
  stale: "status",
  protected: "status",
};

export default function PageState({
  variant,
  title,
  message,
  actions,
  details,
  className = "",
  headingLevel = 2,
}: PageStateProps) {
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      className={`page-state page-state-${variant} ${className}`.trim()}
      role={liveRoleByVariant[variant]}
      aria-live={variant === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="page-state-marker" aria-hidden="true" />
      <div className="page-state-content">
        <Heading className="page-state-title">{title}</Heading>
        <p className="page-state-message">{message}</p>
        {details ? <div className="page-state-details">{details}</div> : null}
        {actions ? <div className="page-state-actions">{actions}</div> : null}
      </div>
    </section>
  );
}
