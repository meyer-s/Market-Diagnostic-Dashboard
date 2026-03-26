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
        className="ml-2 w-5 h-5 rounded-full bg-gray-800 border border-gray-700 text-gray-300 text-xs flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        i
      </button>
      <div
        role="tooltip"
        id={id}
        className="absolute z-50 hidden w-64 right-0 mt-2 text-xs text-gray-200 bg-gray-900 border border-gray-700 rounded shadow-lg p-2 pointer-events-none group-hover:block"
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
