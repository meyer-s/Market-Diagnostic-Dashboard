type Props = {
  text: string
  id?: string
}

export default function InfoTooltip({ text, id }: Props) {
  return (
    <div className="relative inline-block">
      <button
        aria-describedby={id}
        type="button"
        aria-label="Show supporting context"
        className="ml-1 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-transparent text-stealth-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-stealth-600 bg-stealth-800 text-xs font-semibold">
          i
        </span>
      </button>
      <div
        role="tooltip"
        id={id}
        className="absolute z-50 hidden w-64 right-0 mt-2 text-xs text-stealth-200 bg-stealth-900 border border-stealth-700 rounded shadow-lg p-2 pointer-events-none group-hover:block"
        style={{ pointerEvents: 'auto' }}
      >
        {text}
      </div>
      <style>{`
        /* show tooltip on parent hover/focus-within */
        .relative.inline-block:hover > div[role='tooltip'],
        .relative.inline-block:focus-within > div[role='tooltip'] {
          display: block;
        }
      `}</style>
    </div>
  )
}
