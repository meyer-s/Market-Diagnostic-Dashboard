import MarketLoading from "./MarketLoading";
import { useGlobalLoading } from "../../utils/loadingStore";

export default function GlobalLoading() {
  const { isLoading } = useGlobalLoading();

  if (!isLoading) return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 pointer-events-none">
      <MarketLoading size={52} variant="drift" label="Loading requested market data…" />
    </div>
  );
}
