import { ComponentChart } from '../components/widgets/ComponentChart';
import { ComponentCard } from '../components/widgets/ComponentCard';
import { processComponentData } from './chartDataUtils';

interface ComponentBreakdownProps {
  title: string;
  description: string;
  formula?: string;
  formulaNote?: string;
  latestValues: { label: string; value: string | number; valueColor: string; subtitle?: string; weight?: number }[];
  charts: {
    title: string;
    subtitle?: string;
    data: Record<string, unknown>[];
    daysBack: number;
    lines: { dataKey: string; name: string; stroke: string; strokeWidth?: number; conditional?: (data: object[]) => boolean }[];
    referenceLines?: { y: number; stroke: string; label: string; labelFill: string; labelPosition?: 'left' | 'right' | 'insideTopRight' | 'insideBottomRight'; fontSize?: number }[];
    yAxisLabel: string;
    yAxisDomain?: [number, number];
  }[];
}

export function ComponentBreakdown({
  title,
  description,
  formula,
  formulaNote,
  latestValues,
  charts
}: ComponentBreakdownProps) {
  return (
    <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
      <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4 text-stealth-100">{title}</h3>
      <p className="text-xs md:text-sm text-stealth-400 mb-2 break-all">{description}</p>
      
      {formula && (
        <p className="text-xs md:text-sm text-stealth-400 mb-3 md:mb-4 font-mono break-all">{formula}</p>
      )}
      
      {formulaNote && (
        <div className="bg-stealth-900 border border-stealth-600 rounded p-2 md:p-3 mb-4 md:mb-6">
          <p className="text-xs text-stealth-300" dangerouslySetInnerHTML={{ __html: formulaNote }} />
        </div>
      )}
      
      {/* Latest Component Values */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
        {latestValues.map((item, idx) => (
          <ComponentCard key={idx} {...item} />
        ))}
      </div>

      {/* Charts */}
      {charts.map((chart, idx) => {
        const { data, dateRange } = processComponentData(chart.data, chart.daysBack);
        
        return (
          <div key={idx} className={`h-80 ${idx < charts.length - 1 ? 'mb-6' : ''}`}>
            <h4 className="text-sm font-semibold mb-2 text-stealth-200">{chart.title}</h4>
            {chart.subtitle && (
              <p className="text-xs text-stealth-400 mb-2">{chart.subtitle}</p>
            )}
            <ComponentChart
              data={data}
              lines={chart.lines}
              referenceLines={chart.referenceLines}
              yAxisLabel={chart.yAxisLabel}
              yAxisDomain={chart.yAxisDomain}
              dateRange={dateRange}
            />
          </div>
        );
      })}
    </div>
  );
}
