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
      <circle cx="168" cy="128" r="118" fill="url(#visionOrbA)" filter="url(#visionSoftBlur)" />
      <circle cx="1246" cy="336" r="312" fill="url(#visionOrbB)" filter="url(#visionSoftBlur)" />

      <path
        d="M-20 444 C228 426, 478 430, 714 396 C914 368, 1078 320, 1248 316 C1376 312, 1464 336, 1496 358 L1496 560 L-20 560 Z"
        fill="url(#visionRibbonFill)"
      />
      <path
        d="M-12 392 C206 370, 444 376, 684 346 C900 320, 1084 278, 1248 282 C1376 284, 1462 316, 1496 340"
        stroke="url(#visionRibbonA)"
        strokeWidth="4.1"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-12 330 C192 302, 432 322, 672 292 C904 262, 1088 208, 1252 212 C1378 216, 1464 252, 1496 278"
        stroke="url(#visionRibbonB)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="6 12"
        opacity="0.9"
      />
      <path
        d="M-12 262 C200 244, 432 252, 684 236 C930 220, 1112 164, 1262 164 C1382 164, 1468 198, 1496 220"
        stroke="#cbd5e1"
        strokeOpacity="0.2"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="3 16"
      />

      {[55, 89, 144, 233].map((r, idx) => (
        <path
          key={`fib-left-${r}`}
          d={`M ${1224 - r} 334 A ${r} ${r} 0 0 1 1224 ${334 - r}`}
          fill="none"
          stroke={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
          strokeOpacity={0.58 - idx * 0.1}
          strokeWidth={2.2 - idx * 0.25}
          strokeLinecap="round"
        />
      ))}

      {[55, 89, 144].map((r, idx) => (
        <path
          key={`fib-right-${r}`}
          d={`M 1224 ${334 - r} A ${r} ${r} 0 0 1 ${1224 + r} 334`}
          fill="none"
          stroke={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
          strokeOpacity={0.46 - idx * 0.09}
          strokeWidth={1.9 - idx * 0.18}
          strokeLinecap="round"
        />
      ))}

      {[988, 1078, 1168, 1258, 1348].map((x) => (
        <circle key={`detail-${x}`} cx={x} cy="250" r="3.2" fill="#93C5FD" fillOpacity="0.62" />
      ))}

      <circle cx="1224" cy="334" r="55" fill="none" stroke="#6EE7B7" strokeOpacity="0.2" strokeWidth="1.4" />
      <circle cx="1224" cy="334" r="13" fill="#f8fafc" fillOpacity="0.82" />
    </svg>
  );
}

function PrincipleMotifGraphic({ motif }: { motif: PrincipleMotif }) {
  if (motif === "board") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Board zoom-out motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        <rect x="22" y="14" width="196" height="68" rx="12" fill="#0d1526" stroke="#334155" />
        <rect x="56" y="26" width="128" height="44" rx="9" fill="none" stroke="#93C5FD" strokeOpacity="0.6" strokeWidth="1.7" />
        <rect x="72" y="34" width="96" height="28" rx="7" fill="none" stroke="#6EE7B7" strokeOpacity="0.82" strokeWidth="1.7" />
        {[56, 184, 72, 168].map((x, idx) => (
          <circle key={`board-node-${x}-${idx}`} cx={x} cy={idx < 2 ? 26 : 62} r="3.4" fill="#93C5FD" fillOpacity="0.72" />
        ))}
        <circle cx="120" cy="48" r="5.6" fill="#6EE7B7" fillOpacity="0.94" />
        <path
          d="M78 56 C94 48, 108 54, 122 43 C134 34, 148 35, 164 39"
          stroke="#6EE7B7"
          strokeOpacity="0.8"
          strokeWidth="1.9"
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
          d="M18 74 C44 82, 72 80, 96 70 C122 60, 146 62, 170 52 C190 44, 204 36, 220 24"
          fill="none"
          stroke="#64748b"
          strokeOpacity="0.82"
          strokeWidth="2.8"
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
        <circle cx="112" cy="50" r="4.2" fill="#6EE7B7" fillOpacity="0.24" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 96" role="img" aria-label="Decision reinforcement motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
      <circle cx="48" cy="28" r="6" fill="#93C5FD" fillOpacity="0.78" />
      <circle cx="48" cy="68" r="6" fill="#6EE7B7" fillOpacity="0.78" />
      <circle cx="112" cy="48" r="9.5" fill="#f8fafc" fillOpacity="0.9" />
      <circle cx="192" cy="48" r="9" fill="#6EE7B7" fillOpacity="0.92" />

      <path d="M54 28 C78 30, 94 36, 106 44" stroke="#93C5FD" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <path d="M54 68 C78 66, 94 60, 106 52" stroke="#6EE7B7" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <path d="M122 48 C146 48, 166 48, 184 48" stroke="#f8fafc" strokeOpacity="0.92" strokeWidth="2.7" fill="none" strokeLinecap="round" />
      <path d="M148 26 C168 30, 182 38, 190 46" stroke="#93C5FD" strokeOpacity="0.72" strokeWidth="1.9" fill="none" strokeLinecap="round" />
      <path d="M148 70 C168 66, 182 58, 190 50" stroke="#6EE7B7" strokeOpacity="0.72" strokeWidth="1.9" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function AudienceContextGraphic() {
  return (
    <svg viewBox="0 0 360 132" role="img" aria-label="People and conversation motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="359" height="131" rx="19.5" fill="#0f172a" stroke="#334155" />

      <circle cx="96" cy="46" r="11.5" fill="#93C5FD" fillOpacity="0.84" />
      <path d="M72 92 C80 72, 112 72, 120 92" fill="none" stroke="#93C5FD" strokeOpacity="0.78" strokeWidth="3" strokeLinecap="round" />

      <circle cx="264" cy="46" r="11.5" fill="#6EE7B7" fillOpacity="0.86" />
      <path d="M240 92 C248 72, 280 72, 288 92" fill="none" stroke="#6EE7B7" strokeOpacity="0.8" strokeWidth="3" strokeLinecap="round" />

      <rect x="132" y="24" width="96" height="28" rx="12" fill="#1e293b" stroke="#334155" />
      <path d="M172 52 L178 62 L186 52" fill="#1e293b" stroke="#334155" />
      <circle cx="158" cy="38" r="2.3" fill="#e2e8f0" />
      <circle cx="172" cy="38" r="2.3" fill="#e2e8f0" />
      <circle cx="186" cy="38" r="2.3" fill="#e2e8f0" />

      <path d="M108 48 C126 40, 140 38, 156 38" fill="none" stroke="#93C5FD" strokeWidth="2" strokeLinecap="round" />
      <path d="M228 38 C244 38, 254 40, 272 48" fill="none" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round" />
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
