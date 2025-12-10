import { IndicatorHistoryPoint } from "../../types";

interface Props {
  history: IndicatorHistoryPoint[];
  height?: number;
  width?: number;
}

export default function StateSparkline({ history, height = 24, width = 200 }: Props) {
  if (!history || history.length === 0) {
    return (
      <div className="flex items-center gap-1" style={{ height, width }}>
        <div className="text-xs text-stealth-400">No data</div>
      </div>
    );
  }

  // Take last 60 data points for display
  const displayData = history.slice(-60);
  const dotSize = 4;
  const gap = (width - dotSize * displayData.length) / (displayData.length - 1 || 1);

  const getColor = (state: string) => {
    switch (state) {
      case 'GREEN': return '#10b981';
      case 'YELLOW': return '#eab308';
      case 'RED': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div className="flex items-center gap-1" style={{ height, width }}>
      <svg width={width} height={height}>
        {displayData.map((point, index) => {
          const x = index * (dotSize + gap) + dotSize / 2;
          const y = height / 2;
          
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={dotSize / 2}
              fill={getColor(point.state)}
              opacity={0.8}
            >
              <title>{`${new Date(point.timestamp).toLocaleDateString()}: ${point.state}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
