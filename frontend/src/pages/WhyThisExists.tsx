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
    <div className="rounded-3xl border border-stealth-700/90 bg-stealth-900/75 p-2 shadow-[0_24px_80px_rgba(5,12,24,0.48)]">
      <svg
        viewBox="0 0 560 360"
        role="img"
        aria-label="Stylized market context chart illustration"
        className="w-full h-full rounded-[20px]"
      >
        <defs>
          <linearGradient id="visionGlowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id="visionLineA" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#34D399" stopOpacity="0.78" />
          </linearGradient>
          <linearGradient id="visionLineB" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.78" />
          </linearGradient>
          <linearGradient id="visionBars" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#94A3B8" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#CBD5E1" stopOpacity="0.48" />
          </linearGradient>
          <linearGradient id="visionArea" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="560" height="360" fill="#0f172a" />
        <rect x="0" y="0" width="560" height="360" fill="url(#visionGlowGradient)" />

        {[56, 104, 152, 200, 248, 296].map((y) => (
          <line
            key={`y-grid-${y}`}
            x1="28"
            y1={y}
            x2="536"
            y2={y}
            stroke="#334155"
            strokeWidth="1"
            strokeOpacity="0.58"
          />
        ))}
        {[64, 128, 192, 256, 320, 384, 448, 512].map((x) => (
          <line
            key={`x-grid-${x}`}
            x1={x}
            y1="32"
            x2={x}
            y2="330"
            stroke="#1e293b"
            strokeWidth="1"
            strokeOpacity="0.72"
          />
        ))}

        <path
          d="M40 252 L88 238 L136 242 L184 224 L232 230 L280 198 L328 186 L376 204 L424 174 L472 166 L520 146 L520 330 L40 330 Z"
          fill="url(#visionArea)"
        />
        <path
          d="M40 252 L88 238 L136 242 L184 224 L232 230 L280 198 L328 186 L376 204 L424 174 L472 166 L520 146"
          stroke="url(#visionLineA)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M40 216 L88 214 L136 204 L184 214 L232 206 L280 186 L328 194 L376 180 L424 186 L472 176 L520 178"
          stroke="url(#visionLineB)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="5 8"
          opacity="0.94"
        />

        {[0, 1, 2, 3, 4, 5, 6].map((idx) => {
          const x = 66 + idx * 64;
          const height = [28, 44, 34, 56, 42, 62, 50][idx];
          return (
            <rect
              key={`bar-${idx}`}
              x={x}
              y={300 - height}
              width="22"
              height={height}
              rx="6"
              fill="url(#visionBars)"
              opacity={0.92}
            />
          );
        })}

        {[40, 184, 280, 424, 520].map((x, idx) => (
          <circle
            key={`node-${x}`}
            cx={x}
            cy={[252, 224, 198, 174, 146][idx]}
            r="5.5"
            fill="#6EE7B7"
            stroke="#0f172a"
            strokeWidth="2"
          />
        ))}

        <rect
          x="356"
          y="36"
          width="168"
          height="72"
          rx="14"
          fill="#0b1220"
          stroke="#334155"
          strokeWidth="1.2"
        />
        <text x="372" y="62" fill="#e2e8f0" fontSize="13" fontWeight="600" letterSpacing="0.05em">
          REGIME CONTEXT
        </text>
        <text x="372" y="84" fill="#94a3b8" fontSize="12">
          Trend: constructive
        </text>
        <text x="372" y="102" fill="#94a3b8" fontSize="12">
          Breadth: improving
        </text>
      </svg>
    </div>
  );
}

function PrincipleMotifGraphic({ motif }: { motif: PrincipleMotif }) {
  if (motif === "board") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Multi-chart board motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        {[
          [16, 14],
          [126, 14],
          [16, 52],
          [126, 52],
        ].map(([x, y], idx) => (
          <g key={`${x}-${y}`}>
            <rect x={x} y={y} width="98" height="30" rx="8" fill="#0f172a" stroke="#1f2937" />
            <path
              d={
                idx === 0
                  ? `M${x + 8} ${y + 20} L${x + 28} ${y + 16} L${x + 48} ${y + 22} L${x + 68} ${y + 10} L${x + 88} ${y + 14}`
                  : idx === 1
                    ? `M${x + 8} ${y + 18} L${x + 28} ${y + 20} L${x + 48} ${y + 12} L${x + 68} ${y + 16} L${x + 88} ${y + 9}`
                    : idx === 2
                      ? `M${x + 8} ${y + 18} L${x + 28} ${y + 14} L${x + 48} ${y + 18} L${x + 68} ${y + 12} L${x + 88} ${y + 7}`
                      : `M${x + 8} ${y + 18} L${x + 28} ${y + 11} L${x + 48} ${y + 19} L${x + 68} ${y + 13} L${x + 88} ${y + 15}`
              }
              stroke={idx % 2 === 0 ? "#6EE7B7" : "#93C5FD"}
              strokeWidth="2.25"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}
      </svg>
    );
  }

  if (motif === "curve") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Learning curve motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        <line x1="28" y1="72" x2="208" y2="72" stroke="#334155" strokeWidth="1.5" />
        <line x1="28" y1="72" x2="28" y2="20" stroke="#334155" strokeWidth="1.5" />
        <path
          d="M32 70 C76 70, 90 56, 114 48 C144 38, 160 34, 208 24"
          fill="none"
          stroke="#6EE7B7"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        {[50, 92, 134, 176, 208].map((x, idx) => (
          <circle key={x} cx={x} cy={[68, 60, 48, 36, 24][idx]} r="4.5" fill="#93C5FD" />
        ))}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 240 96" role="img" aria-label="Decision framework motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
      <rect x="20" y="34" width="62" height="28" rx="10" fill="#0f172a" stroke="#334155" />
      <rect x="152" y="14" width="68" height="26" rx="10" fill="#0f172a" stroke="#334155" />
      <rect x="152" y="56" width="68" height="26" rx="10" fill="#0f172a" stroke="#334155" />
      <path d="M82 48 H132" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M132 48 L148 27" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M132 48 L148 69" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="132" cy="48" r="4.5" fill="#f8fafc" />
    </svg>
  );
}

function AudienceContextGraphic() {
  return (
    <svg viewBox="0 0 360 132" role="img" aria-label="Context ribbon chart motif" className="w-full h-auto">
      <rect x="0.5" y="0.5" width="359" height="131" rx="19.5" fill="#0f172a" stroke="#334155" />
      {[26, 52, 78, 104].map((y) => (
        <line key={y} x1="20" y1={y} x2="340" y2={y} stroke="#1f2937" strokeWidth="1" />
      ))}
      {[60, 105, 150, 195, 240, 285, 330].map((x) => (
        <line key={x} x1={x} y1="18" x2={x} y2="114" stroke="#111827" strokeWidth="1" />
      ))}
      <path
        d="M24 86 C58 80, 82 54, 110 58 C142 62, 160 94, 190 84 C224 72, 248 38, 276 44 C306 50, 322 72, 336 66"
        fill="none"
        stroke="#6EE7B7"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M24 70 C56 74, 84 70, 114 64 C148 56, 172 44, 200 50 C236 58, 266 86, 294 84 C314 82, 326 72, 336 72"
        fill="none"
        stroke="#93C5FD"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="5 7"
      />
    </svg>
  );
}

export default function WhyThisExists() {
  return (
    <div className="bg-stealth-900 text-gray-100">
      <section className="relative overflow-hidden border-b border-stealth-700">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(110,231,183,0.14),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(96,165,250,0.12),_transparent_32%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] items-center">
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
            <HeroSignalIllustration />
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
