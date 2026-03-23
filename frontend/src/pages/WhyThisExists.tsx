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
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#34D399" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="visionRibbonB" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id="visionRibbonFill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.01" />
        </linearGradient>
        <filter id="visionSoftBlur" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="32" />
        </filter>
      </defs>

      <rect x="0" y="0" width="1440" height="560" fill="url(#visionHeroBg)" />
      <circle cx="260" cy="112" r="252" fill="url(#visionOrbA)" filter="url(#visionSoftBlur)" />
      <circle cx="1260" cy="430" r="284" fill="url(#visionOrbB)" filter="url(#visionSoftBlur)" />

      <path
        d="M-40 390 C220 330, 340 450, 580 386 C820 320, 930 210, 1170 250 C1320 276, 1440 340, 1490 386 L1490 560 L-40 560 Z"
        fill="url(#visionRibbonFill)"
      />
      <path
        d="M-32 374 C214 314, 342 432, 580 370 C822 306, 928 204, 1168 244 C1322 272, 1442 332, 1490 370"
        stroke="url(#visionRibbonA)"
        strokeWidth="6.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-32 304 C176 250, 334 310, 548 282 C764 252, 932 168, 1150 192 C1300 210, 1412 254, 1490 300"
        stroke="url(#visionRibbonB)"
        strokeWidth="4.4"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="9 12"
        opacity="0.9"
      />
      <path
        d="M-32 224 C188 188, 336 224, 550 206 C782 186, 930 124, 1146 138 C1298 146, 1412 188, 1490 230"
        stroke="#cbd5e1"
        strokeOpacity="0.35"
        strokeWidth="2.8"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="3 14"
      />

      {[210, 330, 450, 570, 690, 810, 930, 1050, 1170, 1290].map((x, idx) => (
        <g key={`pulse-${x}`}>
          <line
            x1={x}
            y1="450"
            x2={x}
            y2={422 - (idx % 3) * 12}
            stroke="#94a3b8"
            strokeOpacity="0.55"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle
            cx={x}
            cy={414 - (idx % 3) * 12}
            r="3.2"
            fill={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
            fillOpacity="0.82"
          />
        </g>
      ))}

      {[320, 560, 800, 1040, 1280].map((x, idx) => (
        <circle
          key={`halo-${x}`}
          cx={x}
          cy={312 - (idx % 2) * 34}
          r="22"
          fill="none"
          stroke="#e2e8f0"
          strokeOpacity="0.16"
          strokeWidth="1.6"
        />
      ))}

      <circle cx="1224" cy="128" r="82" fill="none" stroke="#6EE7B7" strokeOpacity="0.2" strokeWidth="2.1" />
      <circle cx="1224" cy="128" r="50" fill="none" stroke="#93C5FD" strokeOpacity="0.34" strokeWidth="1.8" />
      <circle cx="1224" cy="128" r="12" fill="#f8fafc" fillOpacity="0.78" />
    </svg>
  );
}

function PrincipleMotifGraphic({ motif }: { motif: PrincipleMotif }) {
  if (motif === "board") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Abstract market-field motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        <circle cx="72" cy="46" r="30" fill="#6EE7B7" fillOpacity="0.12" />
        <circle cx="118" cy="38" r="24" fill="#93C5FD" fillOpacity="0.14" />
        <circle cx="156" cy="52" r="29" fill="#34D399" fillOpacity="0.09" />
        <path
          d="M24 62 C58 44, 84 72, 116 52 C142 36, 172 38, 214 50"
          stroke="#6EE7B7"
          strokeOpacity="0.78"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M26 34 C56 24, 90 46, 122 36 C152 28, 180 18, 214 28"
          stroke="#93C5FD"
          strokeOpacity="0.65"
          strokeWidth="1.9"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="4 7"
        />
      </svg>
    );
  }

  if (motif === "curve") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Abstract learning-wave motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        <path
          d="M20 66 C52 78, 72 44, 104 50 C130 56, 142 82, 170 68 C192 58, 202 34, 220 26"
          fill="none"
          stroke="#6EE7B7"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M24 48 C54 36, 84 66, 110 44 C138 20, 170 34, 214 16"
          fill="none"
          stroke="#93C5FD"
          strokeOpacity="0.7"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="5 8"
        />
        <circle cx="64" cy="52" r="10" fill="#93C5FD" fillOpacity="0.16" />
        <circle cx="172" cy="66" r="12" fill="#6EE7B7" fillOpacity="0.13" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 96" role="img" aria-label="Abstract decision-flow motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
      <circle cx="70" cy="48" r="9" fill="#f8fafc" fillOpacity="0.86" />
      <circle cx="184" cy="26" r="12" fill="#93C5FD" fillOpacity="0.19" />
      <circle cx="184" cy="70" r="12" fill="#6EE7B7" fillOpacity="0.18" />
      <path
        d="M82 48 C112 48, 120 38, 144 30 C158 24, 170 24, 188 26"
        stroke="#93C5FD"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M82 48 C112 50, 122 60, 146 66 C160 70, 170 70, 188 70"
        stroke="#6EE7B7"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M58 30 C88 10, 128 10, 164 20"
        stroke="#cbd5e1"
        strokeOpacity="0.28"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="3 8"
      />
    </svg>
  );
}

function AudienceContextGraphic() {
  return (
    <svg viewBox="0 0 360 132" role="img" aria-label="Abstract context ribbon motif" className="w-full h-auto">
      <defs>
        <linearGradient id="audienceFlowA" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="audienceFlowB" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="359" height="131" rx="19.5" fill="#0f172a" stroke="#334155" />
      <path
        d="M18 90 C56 68, 96 98, 136 82 C174 68, 208 36, 246 46 C286 56, 318 78, 342 72 L342 116 L18 116 Z"
        fill="url(#audienceFlowA)"
      />
      <path
        d="M18 72 C54 54, 92 70, 130 62 C168 54, 202 26, 240 30 C282 34, 318 58, 342 56 L342 98 L18 98 Z"
        fill="url(#audienceFlowB)"
      />
      <path
        d="M20 88 C58 66, 98 96, 138 80 C176 66, 208 36, 246 44 C286 54, 318 76, 340 70"
        fill="none"
        stroke="#6EE7B7"
        strokeOpacity="0.76"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
      <path
        d="M20 64 C56 48, 96 66, 132 58 C170 50, 204 24, 242 28 C284 32, 320 54, 340 54"
        fill="none"
        stroke="#93C5FD"
        strokeOpacity="0.72"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeDasharray="5 7"
      />
      {[42, 96, 152, 206, 262, 316].map((x, idx) => (
        <circle key={`aud-dot-${x}`} cx={x} cy={idx % 2 === 0 ? 96 : 102} r="2.5" fill="#e2e8f0" fillOpacity="0.45" />
      ))}
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
