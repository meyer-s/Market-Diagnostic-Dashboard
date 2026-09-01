import MarketTabs from "../../components/ui/MarketTabs";

export const BLS_VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "releases", label: "Releases" },
  { id: "trends", label: "Trends" },
  { id: "revisions", label: "Revisions" },
  { id: "calendar", label: "Calendar" },
  { id: "methods", label: "Methods & sources" },
] as const;

export type BlsView = (typeof BLS_VIEWS)[number]["id"];

type BlsViewTabsProps = {
  activeView: BlsView;
  onChange: (view: BlsView) => void;
};

export function isBlsView(value: string | null): value is BlsView {
  return BLS_VIEWS.some((view) => view.id === value);
}

export default function BlsViewTabs({ activeView, onChange }: BlsViewTabsProps) {
  return (
    <nav className="bls-view-nav" aria-label="BLS workspaces">
      <label className="bls-view-select-wrap">
        <span>View</span>
        <select
          aria-label="BLS workspace"
          value={activeView}
          onChange={(event) => onChange(event.target.value as BlsView)}
        >
          {BLS_VIEWS.map((view) => (
            <option key={view.id} value={view.id}>{view.label}</option>
          ))}
        </select>
      </label>
      <MarketTabs<BlsView>
        label="BLS Release Lens views"
        value={activeView}
        options={BLS_VIEWS.map((view) => ({
          value: view.id,
          label: view.label,
          panelId: "bls-active-panel",
          tabId: `bls-tab-${view.id}`,
        }))}
        onChange={onChange}
        idPrefix="bls"
        variant="underline"
        className="bls-view-tabs"
      />
    </nav>
  );
}
