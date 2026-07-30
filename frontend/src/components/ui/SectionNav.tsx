export type SectionNavItem = {
  id: string;
  label: string;
};

type SectionNavProps = {
  items: SectionNavItem[];
  label?: string;
  activeId?: string;
  id?: string;
  className?: string;
};

export default function SectionNav({
  items,
  label = "On this page",
  activeId,
  id = "page-sections",
  className = "",
}: SectionNavProps) {
  return (
    <nav id={id} className={`section-nav ${className}`.trim()} aria-label={label}>
      <span className="section-nav-label">{label}</span>
      <div
        className="section-nav-links"
        role="region"
        aria-label={`${label} links`}
        tabIndex={0}
      >
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="section-nav-link"
            aria-current={activeId === item.id ? "location" : undefined}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
