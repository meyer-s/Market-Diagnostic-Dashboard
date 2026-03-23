interface ComponentCardProps {
  label: string;
  value: string | number;
  valueColor: string;
  subtitle?: string;
  weight?: number;
  formatValue?: (v: number) => string;
}

export function ComponentCard({ 
  label, 
  value, 
  valueColor, 
  subtitle, 
  weight 
}: ComponentCardProps) {
  return (
    <div className="secondary-card p-4">
      <div className="text-xs text-stealth-400 mb-1">{label}</div>
      <div className={`text-lg font-bold ${valueColor}`}>
        {typeof value === 'number' ? value.toFixed(2) : value}
      </div>
      {subtitle && (
        <div className="text-xs text-stealth-500 mt-1">
          {subtitle}
        </div>
      )}
      {weight !== undefined && (
        <div className="text-xs text-stealth-500">
          Weight: {(weight * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}
