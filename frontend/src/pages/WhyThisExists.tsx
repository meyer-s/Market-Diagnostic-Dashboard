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
      <circle cx="166" cy="132" r="136" fill="url(#visionOrbA)" filter="url(#visionSoftBlur)" />
      <circle cx="1268" cy="346" r="348" fill="url(#visionOrbB)" filter="url(#visionSoftBlur)" />

      <path
        d="M-20 446 C194 428, 414 430, 638 394 C844 362, 1022 304, 1216 304 C1362 306, 1452 338, 1496 366 L1496 560 L-20 560 Z"
        fill="url(#visionRibbonFill)"
      />
      <path
        d="M-12 406 C178 384, 404 394, 630 366 C844 338, 1024 286, 1220 290 C1366 294, 1452 326, 1496 350"
        stroke="url(#visionRibbonA)"
        strokeWidth="4.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-12 338 C170 312, 386 334, 612 308 C834 282, 1024 220, 1224 226 C1368 230, 1456 266, 1496 292"
        stroke="url(#visionRibbonB)"
        strokeWidth="3.2"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="7 12"
        opacity="0.9"
      />

      <path
        d="M-12 270 C176 252, 386 262, 620 248 C856 236, 1046 170, 1238 172 C1376 174, 1458 206, 1496 230"
        stroke="#cbd5e1"
        strokeOpacity="0.22"
        strokeWidth="1.9"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="3 16"
      />

      <rect x="1000" y="104" width="352" height="352" rx="18" fill="none" stroke="#334155" strokeOpacity="0.22" />
      <rect x="1118" y="222" width="234" height="234" rx="14" fill="none" stroke="#475569" strokeOpacity="0.26" />
      <rect x="1202" y="306" width="150" height="150" rx="12" fill="none" stroke="#64748b" strokeOpacity="0.3" />

      {[34, 55, 89, 144, 233].map((r, idx) => (
        <path
          key={`fib-left-${r}`}
          d={`M ${1236 - r} 340 A ${r} ${r} 0 0 1 1236 ${340 - r}`}
          fill="none"
          stroke={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
          strokeOpacity={0.66 - idx * 0.08}
          strokeWidth={2.4 - idx * 0.2}
          strokeLinecap="round"
        />
      ))}

      {[34, 55, 89, 144].map((r, idx) => (
        <path
          key={`fib-right-${r}`}
          d={`M 1236 ${340 - r} A ${r} ${r} 0 0 1 ${1236 + r} 340`}
          fill="none"
          stroke={idx % 2 === 0 ? "#93C5FD" : "#6EE7B7"}
          strokeOpacity={0.58 - idx * 0.08}
          strokeWidth={2.1 - idx * 0.16}
          strokeLinecap="round"
        />
      ))}

      {[900, 980, 1060, 1140, 1220, 1300, 1380].map((x, idx) => (
        <g key={`pulse-${x}`}>
          <line
            x1={x}
            y1="452"
            x2={x}
            y2={422 - (idx % 3) * 16}
            stroke="#94a3b8"
            strokeOpacity="0.58"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle
            cx={x}
            cy={412 - (idx % 3) * 16}
            r="3.2"
            fill={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
            fillOpacity="0.84"
          />
        </g>
      ))}

      {[1088, 1148, 1208, 1236, 1264, 1324, 1384].map((x, idx) => (
        <circle
          key={`detail-node-${x}`}
          cx={x}
          cy={244 + (idx % 2) * 26}
          r={x === 1236 ? 6.2 : 3.8}
          fill={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
          fillOpacity={x === 1236 ? 0.95 : 0.74}
        />
      ))}

      <circle cx="1236" cy="340" r="89" fill="none" stroke="#6EE7B7" strokeOpacity="0.18" strokeWidth="1.7" />
      <circle cx="1236" cy="340" r="55" fill="none" stroke="#93C5FD" strokeOpacity="0.28" strokeWidth="1.5" />
      <circle cx="1236" cy="340" r="13" fill="#f8fafc" fillOpacity="0.82" />
    </svg>
  );
}

function PrincipleMotifGraphic({ motif }: { motif: PrincipleMotif }) {
  if (motif === "board") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Board zoom-out motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        <rect x="16" y="10" width="208" height="76" rx="14" fill="#0d1526" stroke="#334155" />
        <path d="M80 10 V86 M120 10 V86 M160 10 V86 M16 34 H224 M16 58 H224" stroke="#1f2937" strokeWidth="1.1" />
        <rect x="46" y="20" width="148" height="56" rx="11" fill="none" stroke="#93C5FD" strokeOpacity="0.55" strokeWidth="1.8" />
        <rect x="64" y="30" width="112" height="36" rx="9" fill="none" stroke="#6EE7B7" strokeOpacity="0.78" strokeWidth="1.8" />
        {[46, 194, 16, 224].map((x, idx) => (
          <circle key={`zoom-${x}-${idx}`} cx={x} cy={idx < 2 ? 20 : 76} r="3.2" fill="#93C5FD" fillOpacity="0.75" />
        ))}
        <circle cx="120" cy="48" r="5.8" fill="#6EE7B7" fillOpacity="0.95" />
        <path d="M120 48 L46 20 M120 48 L194 20 M120 48 L16 76 M120 48 L224 76" stroke="#334155" strokeWidth="1.3" />
        <path
          d="M72 56 C90 48, 106 54, 122 42 C136 32, 154 34, 172 38"
          stroke="#6EE7B7"
          strokeOpacity="0.86"
          strokeWidth="2"
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
          d="M18 74 C42 82, 66 80, 88 72 C112 64, 132 66, 152 58 C174 50, 194 38, 220 24"
          fill="none"
          stroke="#64748b"
          strokeOpacity="0.88"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M18 74 C78 58, 140 44, 220 24"
          fill="none"
          stroke="#6EE7B7"
          strokeOpacity="0.96"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <polygon points="220,24 210,24 216,18" fill="#6EE7B7" fillOpacity="0.92" />
        <circle cx="18" cy="74" r="4.5" fill="#93C5FD" fillOpacity="0.85" />
        <circle cx="220" cy="24" r="5.5" fill="#6EE7B7" fillOpacity="0.95" />
        <circle cx="112" cy="50" r="4.4" fill="#6EE7B7" fillOpacity="0.28" />
        <circle cx="160" cy="56" r="3.3" fill="#94a3b8" fillOpacity="0.45" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 96" role="img" aria-label="Decision reinforcement motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
      <circle cx="42" cy="24" r="5.8" fill="#93C5FD" fillOpacity="0.78" />
      <circle cx="34" cy="48" r="6.2" fill="#cbd5e1" fillOpacity="0.7" />
      <circle cx="42" cy="72" r="5.8" fill="#6EE7B7" fillOpacity="0.78" />
      <circle cx="114" cy="48" r="9.8" fill="#f8fafc" fillOpacity="0.92" />
      <circle cx="154" cy="24" r="5.8" fill="#93C5FD" fillOpacity="0.72" />
      <circle cx="154" cy="72" r="5.8" fill="#6EE7B7" fillOpacity="0.72" />
      <circle cx="198" cy="48" r="8.8" fill="#6EE7B7" fillOpacity="0.95" />

      <path d="M48 24 C76 24, 90 34, 106 44" stroke="#93C5FD" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <path d="M40 48 C68 48, 86 48, 104 48" stroke="#cbd5e1" strokeOpacity="0.75" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <path d="M48 72 C76 72, 90 62, 106 52" stroke="#6EE7B7" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <path d="M124 48 C148 48, 170 48, 190 48" stroke="#f8fafc" strokeOpacity="0.92" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      <path d="M160 24 C178 30, 188 38, 196 44" stroke="#93C5FD" strokeOpacity="0.75" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M160 72 C178 66, 188 58, 196 52" stroke="#6EE7B7" strokeOpacity="0.75" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function AudienceContextGraphic() {
  return (
    <svg viewBox="0 0 360 132" role="img" aria-label="People and conversation motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="359" height="131" rx="19.5" fill="#0f172a" stroke="#334155" />
      <circle cx="86" cy="44" r="11.5" fill="#93C5FD" fillOpacity="0.85" />
      <path d="M60 92 C68 70, 104 70, 112 92" fill="none" stroke="#93C5FD" strokeOpacity="0.8" strokeWidth="3.1" strokeLinecap="round" />

      <circle cx="180" cy="38" r="10.5" fill="#f8fafc" fillOpacity="0.88" />
      <path d="M158 86 C164 66, 196 66, 202 86" fill="none" stroke="#cbd5e1" strokeOpacity="0.9" strokeWidth="2.9" strokeLinecap="round" />

      <circle cx="274" cy="44" r="11.5" fill="#6EE7B7" fillOpacity="0.88" />
      <path d="M248 92 C256 70, 292 70, 300 92" fill="none" stroke="#6EE7B7" strokeOpacity="0.82" strokeWidth="3.1" strokeLinecap="round" />

      <rect x="126" y="16" width="96" height="26" rx="12" fill="#1e293b" stroke="#334155" />
      <path d="M170 42 L164 52 L178 44" fill="#1e293b" stroke="#334155" />
      <circle cx="150" cy="29" r="2.2" fill="#e2e8f0" />
      <circle cx="164" cy="29" r="2.2" fill="#e2e8f0" />
      <circle cx="178" cy="29" r="2.2" fill="#e2e8f0" />

      <rect x="142" y="62" width="86" height="24" rx="11" fill="#1e293b" stroke="#334155" />
      <path d="M188 86 L194 95 L201 86" fill="#1e293b" stroke="#334155" />
      <circle cx="164" cy="74" r="2.2" fill="#e2e8f0" />
      <circle cx="178" cy="74" r="2.2" fill="#e2e8f0" />
      <circle cx="192" cy="74" r="2.2" fill="#e2e8f0" />

      <path d="M98 44 C116 38, 132 36, 148 38" fill="none" stroke="#93C5FD" strokeWidth="2" strokeLinecap="round" />
      <path d="M212 68 C230 64, 246 56, 262 50" fill="none" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round" />
      <path d="M182 48 C186 54, 188 58, 192 62" fill="none" stroke="#e2e8f0" strokeOpacity="0.6" strokeWidth="1.6" strokeLinecap="round" />
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
