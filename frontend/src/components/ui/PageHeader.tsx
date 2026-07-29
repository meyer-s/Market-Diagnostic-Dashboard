import { useId, type ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  kicker?: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
};

export default function PageHeader({
  title,
  kicker,
  description,
  meta,
  actions,
  className = "",
  titleId,
}: PageHeaderProps) {
  const generatedId = useId();
  const headingId = titleId ?? `page-title-${generatedId.replace(/:/g, "")}`;

  return (
    <header
      className={`page-header ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <div className="page-header-copy">
        {kicker ? <p className="page-kicker">{kicker}</p> : null}
        <h1 id={headingId} className="page-title">{title}</h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
        {meta ? <div className="page-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
