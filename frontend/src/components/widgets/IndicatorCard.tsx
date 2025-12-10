import { IndicatorStatus } from "../../types";
import { Link } from "react-router-dom";

interface Props {
  indicator: IndicatorStatus;
}

const colorMap = {
  GREEN: "text-accent-green",
  YELLOW: "text-accent-yellow",
  RED: "text-accent-red",
};

export default function IndicatorCard({ indicator }: Props) {
  return (
    <Link to={`/indicators/${indicator.code}`}>
      <div className="bg-stealth-800 rounded p-4 shadow hover:bg-stealth-700 transition">
        <div className="text-gray-300 text-sm">{indicator.name}</div>
        <div className="text-2xl font-semibold mt-2">
          {typeof indicator.raw_value === 'number' 
            ? indicator.raw_value.toFixed(2) 
            : indicator.raw_value}
        </div>
        <div className="flex justify-between items-center mt-2">
          <span className="text-sm text-gray-400">Score: {indicator.score}</span>
          <span className={`font-semibold ${colorMap[indicator.state]}`}>
            {indicator.state}
          </span>
        </div>
      </div>
    </Link>
  );
}