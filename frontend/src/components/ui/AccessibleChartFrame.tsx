import { useId, type ReactNode } from "react";

export type AccessibleChartFrameProps = {
  title: string;
  children: ReactNode;
  description?: string;
  summary?: string;
  actions?: ReactNode;
  dataTable?: ReactNode;
  dataLabel?: string;
  dataContentFocusable?: boolean;
  className?: string;
};

export default function AccessibleChartFrame({
  title,
  children,
  description,
  summary,
  actions,
  dataTable,
  dataLabel,
  dataContentFocusable = true,
  className = "",
}: AccessibleChartFrameProps) {
  const baseId = useId().replace(/:/g, "");
  const titleId = `chart-title-${baseId}`;
  const descriptionId = description ? `chart-description-${baseId}` : undefined;
  const summaryId = summary ? `chart-summary-${baseId}` : undefined;
  const describedBy = [descriptionId, summaryId].filter(Boolean).join(" ") || undefined;

  return (
    <figure
      className={`chart-frame ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
    >
      <figcaption className="chart-frame-header">
        <div>
          <h2 id={titleId} className="chart-frame-title">{title}</h2>
          {description ? (
            <p id={descriptionId} className="chart-frame-description">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="chart-frame-actions">{actions}</div> : null}
      </figcaption>
      {summary ? <p id={summaryId} className="chart-frame-summary">{summary}</p> : null}
      <div className="chart-frame-visual">{children}</div>
      {dataTable ? (
        <details className="chart-frame-data">
          <summary>View chart data</summary>
          <div
            className="chart-frame-data-content"
            role="region"
            aria-label={dataLabel ?? `${title} data`}
            tabIndex={dataContentFocusable ? 0 : undefined}
          >
            {dataTable}
          </div>
        </details>
      ) : null}
    </figure>
  );
}
