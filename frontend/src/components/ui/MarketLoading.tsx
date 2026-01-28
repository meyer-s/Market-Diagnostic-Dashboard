import React from "react";

export type MarketLoadingVariant = "pulse" | "scan" | "drift";

interface MarketLoadingProps {
  size?: number;
  label?: string;
  variant?: MarketLoadingVariant;
}

export default function MarketLoading({
  size = 96,
  label = "Updating signals...",
  variant = "pulse",
}: MarketLoadingProps) {
  const baseMessages = [
    "Thanks for hanging tight.",
    "Lining things up for you.",
    "Cross-checking the latest reads.",
    "Pulling one more thread.",
    "Almost there, just syncing.",
    "Quick double-check, then we go.",
    "Appreciate the patience.",
    "Right on schedule.",
    "You're in good hands.",
    "Great things take a beat.",
    "We are almost dialed in.",
    "Keeping it steady.",
    "Just a moment more.",
  ];

  const contextualMessages: string[] = [];
  const normalizedLabel = (label ?? "").toLowerCase();
  if (normalizedLabel.includes("market map")) {
    contextualMessages.push(
      "Pinning down market leadership.",
      "Plotting sector flow."
    );
  }
  if (normalizedLabel.includes("sector")) {
    contextualMessages.push(
      "Reading sector leadership.",
      "Aligning sector momentum."
    );
  }
  if (normalizedLabel.includes("stock")) {
    contextualMessages.push(
      "Lining up stock signals.",
      "Calibrating equity drivers."
    );
  }
  if (normalizedLabel.includes("alternative")) {
    contextualMessages.push(
      "Checking alternative shifts.",
      "Balancing the alt lens."
    );
  }
  if (normalizedLabel.includes("indicator")) {
    contextualMessages.push(
      "Refreshing signal set.",
      "Tuning the indicator stack."
    );
  }
  if (normalizedLabel.includes("system")) {
    contextualMessages.push(
      "Mapping systemic pressure.",
      "Aligning system signals."
    );
  }
  if (normalizedLabel.includes("dashboard")) {
    contextualMessages.push(
      "Assembling the overview.",
      "Bringing the board to life."
    );
  }
  if (normalizedLabel.includes("precious")) {
    contextualMessages.push(
      "Polishing the metals read.",
      "Checking safe-haven flows."
    );
  }
  if (normalizedLabel.includes("component")) {
    contextualMessages.push(
      "Breaking down components.",
      "Aligning component inputs."
    );
  }
  if (normalizedLabel.includes("projection")) {
    contextualMessages.push(
      "Running projection checks.",
      "Validating projection context."
    );
  }

  const messagePool =
    contextualMessages.length > 0
      ? contextualMessages.concat(baseMessages)
      : baseMessages;
  const message = React.useMemo(() => {
    return messagePool[Math.floor(Math.random() * messagePool.length)];
  }, [messagePool.join("|")]);
  const isPulse = variant === "pulse";
  const isScan = variant === "scan";
  const iconClass =
    isPulse
      ? "market-loading-pulse-icon"
      : variant === "drift"
        ? "market-loading-drift"
        : "";
  const lineClass = isPulse
    ? "market-loading-pulse-path"
    : isScan
      ? "market-loading-scan-path"
      : "";
  const dotClass = isPulse
    ? "market-loading-pulse-dot"
    : isScan
      ? "market-loading-scan-dot"
      : "";

  return (
    <div
      className="flex flex-col items-center gap-3"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div
        className="relative flex items-center justify-center rounded-2xl bg-stealth-900/60 p-4"
        style={{ width: size + 28, height: size + 28 }}
      >
        <svg
          viewBox="0 0 96 96"
          width={size}
          height={size}
          className={`block select-none ${iconClass}`}
          aria-hidden="true"
        >
          <rect x="18" y="60" width="12" height="16" rx="2" fill="#1c2636" />
          <rect x="36" y="54" width="12" height="22" rx="2" fill="#243045" />
          <rect x="54" y="50" width="12" height="26" rx="2" fill="#1f2b3e" />
          <rect x="72" y="42" width="12" height="34" rx="2" fill="#2a3a52" />

          <circle cx="70" cy="72" r="2" fill="#1f2b3e" opacity="0.6" />
          <circle cx="78" cy="68" r="2.2" fill="#1f2b3e" opacity="0.55" />
          <circle cx="86" cy="64" r="2.4" fill="#1f2b3e" opacity="0.5" />

          <path
            d="M14 54 C20 44, 28 62, 34 52 C38 46, 44 46, 50 50 C56 54, 62 48, 68 42 C72 38, 78 34, 86 32"
            stroke="#3b82f6"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.32"
          />
          <path
            d="M14 54 C20 44, 28 62, 34 52 C38 46, 44 46, 50 50 C56 54, 62 48, 68 42 C72 38, 78 34, 86 32"
            stroke="#93c5fd"
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={lineClass}
            pathLength={100}
          />
          <circle cx="34" cy="52" r="3" fill="#60a5fa" opacity="0.65" />
          <circle cx="50" cy="50" r="3" fill="#60a5fa" opacity="0.65" />
          <circle cx="68" cy="42" r="3" fill="#60a5fa" opacity="0.65" />
          <circle
            cx="86"
            cy="32"
            r="3.6"
            fill="#93c5fd"
            className={dotClass}
          />
        </svg>
      </div>

      {label ? (
        <div className="text-xs text-stealth-400 tracking-wide">{label}</div>
      ) : null}
      {message ? (
        <div className="text-xs text-stealth-500 tracking-wide">
          {message}
        </div>
      ) : null}

      <style>{`
        @keyframes market-loading-pulse-icon {
          0% {
            opacity: 0.85;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0.85;
          }
        }

        @keyframes market-loading-pulse-line {
          0% {
            stroke-dashoffset: 100;
            opacity: 0;
          }
          20% {
            opacity: 0.35;
          }
          50% {
            opacity: 0.55;
          }
          80% {
            opacity: 0.35;
          }
          100% {
            stroke-dashoffset: -100;
            opacity: 0;
          }
        }

        @keyframes market-loading-scan-line {
          0% {
            stroke-dashoffset: 120;
            opacity: 0;
          }
          30% {
            opacity: 0.45;
          }
          65% {
            opacity: 0.7;
          }
          100% {
            stroke-dashoffset: -120;
            opacity: 0;
          }
        }

        @keyframes market-loading-pulse-dot {
          0% {
            opacity: 0.45;
          }
          40% {
            opacity: 0.8;
          }
          100% {
            opacity: 0.45;
          }
        }

        @keyframes market-loading-scan-dot {
          0% {
            opacity: 0.4;
          }
          45% {
            opacity: 1;
          }
          100% {
            opacity: 0.4;
          }
        }

        @keyframes market-loading-drift {
          0% {
            transform: translate(0, 0) rotate(-1deg);
          }
          50% {
            transform: translate(3px, -2px) rotate(1deg);
          }
          100% {
            transform: translate(-2px, 2px) rotate(-1deg);
          }
        }

        @keyframes market-loading-scan {
          0% {
            transform: translateY(-50%);
            opacity: 0;
          }
          20% {
            opacity: 0.25;
          }
          50% {
            opacity: 0.4;
          }
          100% {
            transform: translateY(260%);
            opacity: 0;
          }
        }

        .market-loading-pulse-icon {
          animation: market-loading-pulse-icon 1.6s ease-in-out infinite;
        }

        .market-loading-pulse-path {
          stroke-dasharray: 16 84;
          stroke-dashoffset: 100;
          filter: drop-shadow(0 0 4px rgba(96, 165, 250, 0.35));
          animation: market-loading-pulse-line 1.6s linear infinite;
        }

        .market-loading-pulse-dot {
          filter: drop-shadow(0 0 4px rgba(147, 197, 253, 0.45));
          animation: market-loading-pulse-dot 1.6s ease-in-out infinite;
        }

        .market-loading-scan-path {
          stroke-dasharray: 20 80;
          stroke-dashoffset: 120;
          filter: drop-shadow(0 0 6px rgba(147, 197, 253, 0.5));
          animation: market-loading-scan-line 2.1s linear infinite;
        }

        .market-loading-scan-dot {
          filter: drop-shadow(0 0 6px rgba(147, 197, 253, 0.55));
          animation: market-loading-scan-dot 2.1s ease-in-out infinite;
        }

        .market-loading-drift {
          animation: market-loading-drift 3s ease-in-out infinite;
        }

        .market-loading-scan-line {
          display: none;
        }
      `}</style>
    </div>
  );
}
