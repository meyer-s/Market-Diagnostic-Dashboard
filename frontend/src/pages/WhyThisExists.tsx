import { Link } from "react-router-dom";

type PrincipleMotif = "board" | "curve" | "decision";

type PrincipleCard = {
  title: string;
  body: string;
  motif: PrincipleMotif;
};

const principles = [
  {
    title: "See The Full Board",
    body:
      "Professionals rarely look at one chart in isolation. They compare breadth, rates, credit, leadership, volatility, commodities, and alternative assets together. This dashboard brings those relationships into one place so you can read the market in context instead of in fragments.",
    motif: "board",
  },
  {
    title: "Shorten The Learning Curve",
    body:
      "Experience still matters, but much of that experience is really repetition: seeing the same intermarket shifts enough times to know what they usually imply. The goal here is to shorten that learning curve by making the structure legible earlier.",
    motif: "curve",
  },
  {
    title: "Support Better Decisions",
    body:
      "This tool is not here to pretend every move is obvious or to remove uncertainty. It is here to improve the quality of your questions, clarify the backdrop, and help you act with more evidence than instinct alone.",
    motif: "decision",
  },
] satisfies PrincipleCard[];

const audience = [
  "Investors who know they should care about macro conditions but do not want to piece them together across ten tabs.",
  "Traders who want a faster read on whether the tape is confirming or fighting their thesis.",
  "Curious learners who want to think more like a professional without pretending to already be one.",
];

function HeroSignalIllustration() {
  return (
    <svg
      viewBox="0 0 1440 560"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="visionHeroBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0b1220" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
        <radialGradient id="visionOrbA" cx="0%" cy="0%" r="120%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="visionOrbB" cx="100%" cy="100%" r="120%">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="visionRibbonA" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.04" />
          <stop offset="62%" stopColor="#6EE7B7" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#34D399" stopOpacity="0.86" />
        </linearGradient>
        <linearGradient id="visionRibbonB" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.03" />
          <stop offset="62%" stopColor="#93C5FD" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.82" />
        </linearGradient>
        <linearGradient id="visionRibbonFill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.14" />
        </linearGradient>
        <filter id="visionSoftBlur" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="32" />
        </filter>
      </defs>

      <rect x="0" y="0" width="1440" height="560" fill="url(#visionHeroBg)" />
      <circle cx="180" cy="126" r="170" fill="url(#visionOrbA)" filter="url(#visionSoftBlur)" />
      <circle cx="1260" cy="362" r="330" fill="url(#visionOrbB)" filter="url(#visionSoftBlur)" />

      <path
        d="M-20 440 C210 416, 420 430, 650 392 C860 356, 1030 300, 1212 304 C1358 308, 1450 338, 1496 366 L1496 560 L-20 560 Z"
        fill="url(#visionRibbonFill)"
      />
      <path
        d="M-16 394 C190 362, 408 382, 640 352 C842 328, 1014 274, 1218 288 C1360 298, 1454 328, 1496 352"
        stroke="url(#visionRibbonA)"
        strokeWidth="5.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-16 324 C168 288, 386 316, 608 288 C828 258, 1008 194, 1222 212 C1360 224, 1460 266, 1496 292"
        stroke="url(#visionRibbonB)"
        strokeWidth="3.8"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="8 12"
        opacity="0.9"
      />
      <path
        d="M-16 264 C186 240, 386 258, 612 242 C850 228, 1032 154, 1232 164 C1368 170, 1456 206, 1496 228"
        stroke="#cbd5e1"
        strokeOpacity="0.26"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="3 14"
      />

      {[880, 960, 1040, 1120, 1200, 1280, 1360].map((x, idx) => (
        <g key={`pulse-${x}`}>
          <line
            x1={x}
            y1="448"
            x2={x}
            y2={416 - (idx % 3) * 16}
            stroke="#94a3b8"
            strokeOpacity="0.6"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <circle
            cx={x}
            cy={406 - (idx % 3) * 16}
            r="3.5"
            fill={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
            fillOpacity="0.86"
          />
        </g>
      ))}

      {[34, 55, 89, 144, 233].map((r, idx) => (
        <path
          key={`fib-left-${r}`}
          d={`M ${1236 - r} 344 A ${r} ${r} 0 0 1 1236 ${344 - r}`}
          fill="none"
          stroke={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
          strokeOpacity={0.7 - idx * 0.1}
          strokeWidth={2.6 - idx * 0.25}
          strokeLinecap="round"
        />
      ))}

      {[34, 55, 89, 144].map((r, idx) => (
        <path
          key={`fib-right-${r}`}
          d={`M 1236 ${344 - r} A ${r} ${r} 0 0 1 ${1236 + r} 344`}
          fill="none"
          stroke={idx % 2 === 0 ? "#93C5FD" : "#6EE7B7"}
          strokeOpacity={0.58 - idx * 0.08}
          strokeWidth={2.2 - idx * 0.2}
          strokeLinecap="round"
        />
      ))}

      {[1108, 1168, 1236, 1302, 1364].map((x, idx) => (
        <circle
          key={`detail-node-${x}`}
          cx={x}
          cy={248 + (idx % 2) * 24}
          r={idx === 2 ? 6 : 3.8}
          fill={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
          fillOpacity={idx === 2 ? 0.95 : 0.75}
        />
      ))}

      <circle cx="1236" cy="344" r="89" fill="none" stroke="#6EE7B7" strokeOpacity="0.18" strokeWidth="1.8" />
      <circle cx="1236" cy="344" r="55" fill="none" stroke="#93C5FD" strokeOpacity="0.28" strokeWidth="1.6" />
      <circle cx="1236" cy="344" r="12" fill="#f8fafc" fillOpacity="0.8" />
    </svg>
  );
}

function PrincipleMotifGraphic({ motif }: { motif: PrincipleMotif }) {
  if (motif === "board") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Board zoom-out motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />

        <rect x="24" y="12" width="192" height="72" rx="14" fill="none" stroke="#475569" strokeOpacity="0.7" />
        <rect x="44" y="22" width="152" height="52" rx="12" fill="none" stroke="#64748b" strokeOpacity="0.75" />
        <rect x="64" y="30" width="112" height="36" rx="10" fill="#0f172a" stroke="#94a3b8" strokeOpacity="0.65" />

        {[
          [36, 24],
          [204, 24],
          [36, 72],
          [204, 72],
          [120, 48],
        ].map(([x, y], idx) => (
          <circle
            key={`board-node-${x}-${y}`}
            cx={x}
            cy={y}
            r={idx === 4 ? 5.5 : 4}
            fill={idx === 4 ? "#6EE7B7" : "#93C5FD"}
            fillOpacity={idx === 4 ? 0.95 : 0.7}
          />
        ))}

        <path d="M120 48 L36 24 M120 48 L204 24 M120 48 L36 72 M120 48 L204 72" stroke="#334155" strokeWidth="1.4" />
        <path
          d="M70 56 C90 50, 106 58, 122 44 C134 34, 150 36, 170 40"
          stroke="#6EE7B7"
          strokeOpacity="0.82"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (motif === "curve") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Learning shortcut curve motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        <path
          d="M18 74 C44 82, 72 80, 94 70 C116 60, 138 62, 156 54 C176 46, 190 36, 220 24"
          fill="none"
          stroke="#64748b"
          strokeOpacity="0.95"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M18 74 C78 58, 140 44, 220 24"
          fill="none"
          stroke="#6EE7B7"
          strokeOpacity="0.92"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <circle cx="18" cy="74" r="4.5" fill="#93C5FD" fillOpacity="0.85" />
        <circle cx="220" cy="24" r="5.5" fill="#6EE7B7" fillOpacity="0.95" />
        <circle cx="110" cy="50" r="4.5" fill="#6EE7B7" fillOpacity="0.32" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 96" role="img" aria-label="Decision reinforcement motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
      <circle cx="56" cy="24" r="6.5" fill="#93C5FD" fillOpacity="0.8" />
      <circle cx="56" cy="72" r="6.5" fill="#6EE7B7" fillOpacity="0.8" />
      <circle cx="116" cy="48" r="10" fill="#f8fafc" fillOpacity="0.9" />
      <circle cx="192" cy="48" r="8.5" fill="#6EE7B7" fillOpacity="0.9" />

      <path
        d="M62 24 C84 24, 96 32, 110 44"
        stroke="#93C5FD"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M62 72 C84 72, 96 64, 110 52"
        stroke="#6EE7B7"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M126 48 C148 48, 166 48, 184 48"
        stroke="#f8fafc"
        strokeOpacity="0.9"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M140 22 C160 28, 172 34, 188 44"
        stroke="#93C5FD"
        strokeOpacity="0.75"
        strokeWidth="2.1"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M140 74 C160 68, 172 62, 188 52"
        stroke="#6EE7B7"
        strokeOpacity="0.75"
        strokeWidth="2.1"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AudienceContextGraphic() {
  return (
    <svg viewBox="0 0 360 132" role="img" aria-label="People and conversation motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="359" height="131" rx="19.5" fill="#0f172a" stroke="#334155" />

      <circle cx="72" cy="44" r="11" fill="#93C5FD" fillOpacity="0.8" />
      <path d="M48 88 C54 70, 90 70, 96 88" fill="none" stroke="#93C5FD" strokeOpacity="0.75" strokeWidth="3" strokeLinecap="round" />

      <circle cx="180" cy="40" r="12" fill="#f8fafc" fillOpacity="0.85" />
      <path d="M152 90 C160 68, 200 68, 208 90" fill="none" stroke="#cbd5e1" strokeOpacity="0.9" strokeWidth="3.2" strokeLinecap="round" />

      <circle cx="288" cy="46" r="11" fill="#6EE7B7" fillOpacity="0.85" />
      <path d="M264 88 C270 70, 306 70, 312 88" fill="none" stroke="#6EE7B7" strokeOpacity="0.8" strokeWidth="3" strokeLinecap="round" />

      <rect x="102" y="18" width="66" height="24" rx="11" fill="#1e293b" stroke="#334155" />
      <circle cx="120" cy="30" r="2.2" fill="#e2e8f0" />
      <circle cx="134" cy="30" r="2.2" fill="#e2e8f0" />
      <circle cx="148" cy="30" r="2.2" fill="#e2e8f0" />

      <rect x="194" y="62" width="74" height="24" rx="11" fill="#1e293b" stroke="#334155" />
      <circle cx="214" cy="74" r="2.2" fill="#e2e8f0" />
      <circle cx="228" cy="74" r="2.2" fill="#e2e8f0" />
      <circle cx="242" cy="74" r="2.2" fill="#e2e8f0" />

      <path d="M92 44 C112 40, 126 40, 146 42" fill="none" stroke="#93C5FD" strokeWidth="2" strokeLinecap="round" />
      <path d="M206 66 C224 62, 240 56, 260 52" fill="none" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function WhyThisExists() {
  return (
    <div className="bg-stealth-900 text-gray-100">
      <section className="relative overflow-hidden border-b border-stealth-700">
        <HeroSignalIllustration />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(110,231,183,0.16),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(96,165,250,0.14),_transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(96deg,_rgba(15,23,42,0.9)_0%,_rgba(15,23,42,0.72)_46%,_rgba(15,23,42,0.42)_100%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Vision
            </div>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold leading-tight text-white">
              Less Guesswork. More Context.
            </h1>
            <p className="mt-6 max-w-3xl text-lg sm:text-xl leading-8 text-stealth-200">
              Built to help you think clearly when markets feel confusing.
            </p>
            <p className="mt-4 max-w-3xl text-base sm:text-lg leading-8 text-stealth-300">
              The core purpose of this tool is to reduce the cognitive load of juggling macro indicators while placing a single trade. Everything affects everything. If you try to carry every signal in your head at once, it can run away from you. This platform helps organize the full backdrop into something readable so you can make decisions without the mental spiral.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
        <div className="grid gap-6 lg:grid-cols-3">
          {principles.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-stealth-700 bg-stealth-800/80 p-6 shadow-[0_16px_50px_rgba(0,0,0,0.18)]"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stealth-400">
                Principle
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-white">{item.title}</h2>
              <div className="mt-4">
                <PrincipleMotifGraphic motif={item.motif} />
              </div>
              <p className="mt-4 text-base leading-7 text-stealth-200">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-stealth-700 bg-stealth-850/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-start">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stealth-400">
              The Humble Case
            </div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold text-white">
              You should not need a decade to read market conditions.
            </h2>
            <p className="mt-5 text-lg leading-8 text-stealth-200">
              There is real value in expertise, and this tool does not replace it. What it can do is reduce the penalty for not having lived through every cycle yourself. By organizing market structure into something readable, it helps you borrow some of the discipline of a professional process before you have all of the professional mileage.
            </p>
            <p className="mt-4 text-lg leading-8 text-stealth-200">
              That matters because informed decisions are often less about finding a perfect prediction and more about knowing the backdrop you are operating inside. When rates, breadth, leadership, and defensive behavior all point in the same direction, that should shape your conviction. When they conflict, that should shape your caution.
            </p>
          </div>

          <div className="rounded-3xl border border-stealth-700 bg-gradient-to-br from-stealth-800 to-stealth-900 p-6 sm:p-7">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Who It Helps
            </div>
            <div className="mt-4">
              <AudienceContextGraphic />
            </div>
            <div className="mt-5 space-y-4">
              {audience.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-stealth-700 bg-white/[0.03] px-4 py-4 text-stealth-200 leading-7"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
        <div className="rounded-3xl border border-stealth-700 bg-stealth-800/80 p-8 sm:p-10 lg:p-12">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stealth-400">
              What The Tool Actually Offers
            </div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold text-white">
              A better framework.
            </h2>
            <p className="mt-5 text-lg leading-8 text-stealth-200">
              The practical value proposition is simple: fewer blind spots, faster context, and a more disciplined read of the market regime. Instead of asking, "What is one chart doing today?" you can ask, "What is the broader market structure telling me, and does my idea fit inside it?"
            </p>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-stealth-900 transition-colors hover:bg-emerald-300"
            >
              Explore The Dashboard
            </Link>
            <Link
              to="/system-breakdown"
              className="inline-flex items-center justify-center rounded-xl border border-stealth-600 px-5 py-3 text-sm font-semibold text-stealth-100 transition-colors hover:border-stealth-400 hover:bg-white/[0.03]"
            >
              Review The Methodology
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
