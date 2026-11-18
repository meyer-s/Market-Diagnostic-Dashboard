import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
};

export default function DetailsDisclosure({ label, children, className = "" }: Props) {
  return (
    <details className={`border-t border-stealth-700 text-xs text-stealth-300 ${className}`}>
      <summary className="min-h-11 cursor-pointer rounded py-3 font-semibold text-stealth-200 hover:text-stealth-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
        {label}
      </summary>
      <div className="space-y-3 pb-2 leading-relaxed">{children}</div>
    </details>
  );
}
