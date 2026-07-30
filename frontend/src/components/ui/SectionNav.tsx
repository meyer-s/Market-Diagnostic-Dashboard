import { useEffect, useState } from "react";

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
  const itemKey = items.map((item) => item.id).join("|");
  const [observedActiveId, setObservedActiveId] = useState(items[0]?.id);

  useEffect(() => {
    if (activeId || !itemKey) return;

    const itemIds = itemKey.split("|");
    let frameId: number | null = null;

    const updateActiveSection = () => {
      frameId = null;
      const sections = itemIds
        .map((itemId) => document.getElementById(itemId))
        .filter((section): section is HTMLElement => Boolean(section));

      if (sections.length === 0) return;

      const hasPageLayout = sections.some((section) => {
        const rect = section.getBoundingClientRect();
        return rect.height > 0 || rect.top !== 0;
      });
      if (!hasPageLayout) {
        setObservedActiveId(itemIds[0]);
        return;
      }

      const threshold = Math.min(180, window.innerHeight * 0.28);
      let nextActiveId = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= threshold) {
          nextActiveId = section.id;
        } else {
          break;
        }
      }
      setObservedActiveId((current) =>
        current === nextActiveId ? current : nextActiveId,
      );
    };

    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateActiveSection);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", scheduleUpdate);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", scheduleUpdate);
    };
  }, [activeId, itemKey]);

  const resolvedActiveId = activeId ?? observedActiveId;

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
            aria-current={resolvedActiveId === item.id ? "location" : undefined}
            onClick={() => setObservedActiveId(item.id)}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
