import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { CHART_MARGIN, CHART_NEUTRAL } from "../../utils/chartUtils";

interface ChartLine {
  dataKey: string;
  name: string;
  stroke: string;
  strokeWidth?: number;
  conditional?: (data: object[]) => boolean; // Check if this line should render
  connectNulls?: boolean;
}

interface ReferenceLineConfig {
  y: number;
  stroke: string;
  label: string;
  labelFill: string;
  labelPosition?: 'left' | 'right' | 'insideTopRight' | 'insideBottomRight';
  fontSize?: number;
}

interface ComponentChartProps {
  data: object[];
  lines: ChartLine[];
  referenceLines?: ReferenceLineConfig[];
  yAxisLabel?: string;
  yAxisDomain?: [number, number] | ['auto', 'auto'];
  height?: string;
  dateRange: { startTime: number; endTime: number };
}

export function ComponentChart({
  data,
  lines,
  referenceLines = [],
  yAxisLabel,
  yAxisDomain,
  height = '100%',
  dateRange
}: ComponentChartProps) {
  const yAxisWidth = yAxisLabel ? 72 : undefined;
  const yAxisLabelProps = yAxisLabel ? {
    value: yAxisLabel,
    angle: -90,
    position: 'insideLeft' as const,
    fill: CHART_NEUTRAL.label,
    offset: 12
  } : undefined;

  return (
    <ResponsiveContainer width="100%" height={height as `${number}%` | number}>
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
        <XAxis
          dataKey="dateNum"
          type="number"
          domain={[dateRange.startTime, dateRange.endTime]}
          scale="time"
          tickFormatter={(v: number) =>
            new Date(v).toLocaleDateString(undefined, {
              month: "short",
              year: "2-digit",
            })
          }
          tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
          stroke={CHART_NEUTRAL.axis}
        />
        <YAxis
          domain={yAxisDomain || ['auto', 'auto']}
          tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
          stroke={CHART_NEUTRAL.axis}
          width={yAxisWidth}
          tickMargin={8}
          label={yAxisLabelProps}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: CHART_NEUTRAL.tooltipBg,
            borderColor: CHART_NEUTRAL.tooltipBorder,
            borderRadius: "8px",
            padding: "12px",
          }}
          labelStyle={{ color: CHART_NEUTRAL.label, marginBottom: "8px" }}
          formatter={(value) => {
            const numeric = typeof value === "number" ? value : Number(value);
            return Number.isFinite(numeric) ? numeric.toFixed(2) : "n/a";
          }}
          labelFormatter={(label: number) => new Date(label).toLocaleDateString()}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: CHART_NEUTRAL.tick }} iconType="circle" />
        {lines.map((line, idx) => {
          // Check if this line should be rendered (for conditional lines)
          if (line.conditional && !line.conditional(data)) {
            return null;
          }
          
          return (
            <Line
              key={idx}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth || 2}
              dot={false}
              connectNulls={line.connectNulls}
            />
          );
        })}
        {referenceLines.map((refLine, idx) => (
          <ReferenceLine
            key={idx}
            y={refLine.y}
            stroke={refLine.stroke}
            strokeDasharray="3 3"
            label={{
              value: refLine.label,
              position: refLine.labelPosition || 'right',
              fill: refLine.labelFill,
              fontSize: refLine.fontSize || 12
            }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
