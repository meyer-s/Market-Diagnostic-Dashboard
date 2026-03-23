import { Link } from "react-router-dom";

const principles = [
  {
    title: "See The Full Board",
    body:
      "Professionals rarely look at one chart in isolation. They compare breadth, rates, credit, leadership, volatility, commodities, and alternative assets together. This dashboard brings those relationships into one place so you can read the market in context instead of in fragments.",
  },
  {
    title: "Shorten The Learning Curve",
    body:
      "Experience still matters, but much of that experience is really repetition: seeing the same intermarket shifts enough times to know what they usually imply. The goal here is to shorten that learning curve by making the structure legible earlier.",
  },
  {
    title: "Support Better Decisions",
    body:
      "This tool is not here to pretend every move is obvious or to remove uncertainty. It is here to improve the quality of your questions, clarify the backdrop, and help you act with more evidence than instinct alone.",
  },
];

const audience = [
  "Investors who know they should care about macro conditions but do not want to piece them together across ten tabs.",
  "Traders who want a faster read on whether the tape is confirming or fighting their thesis.",
  "Curious learners who want to think more like a professional without pretending to already be one.",
];

export default function WhyThisExists() {
  return (
    <div className="bg-stealth-900 text-gray-100">
      <section className="relative overflow-hidden border-b border-stealth-700">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(110,231,183,0.14),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(96,165,250,0.12),_transparent_32%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Vision
            </div>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold leading-tight text-white">
              Less guesswork. More Context.
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