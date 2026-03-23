import { MetalsSubsystemPanel } from './MetalsSubsystemPanel';
import { CryptoSubsystemPanel } from './CryptoSubsystemPanel';
import { MethodologyPanel } from './MethodologyPanel';

interface AASComponent {
  name: string;
  category: string;
  value: number;
  weight: number;
  contribution: number;
  status: 'active' | 'missing';
  description: string;
}

interface DeepDiveTabProps {
  aasData: {
    components: AASComponent[];
    metals_contribution: number;
    crypto_contribution: number;
  };
}

export function DeepDiveTab({ aasData }: DeepDiveTabProps) {
  const components: AASComponent[] = aasData.components || [];
  const metalsComponents = components.filter((c) => c.category === 'metals');
  const cryptoComponents = components.filter((c) => c.category === 'crypto');

  return (
    <div className="space-y-6">
      {/* Subsystem Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetalsSubsystemPanel components={metalsComponents} contribution={aasData.metals_contribution} />
        <CryptoSubsystemPanel components={cryptoComponents} contribution={aasData.crypto_contribution} />
      </div>

      {/* Methodology & Interpretation */}
      <MethodologyPanel />
    </div>
  );
}
