interface Props {
  value: string
  onChange: (v: string) => void
  placeholder: string
  infoText: string
  className?: string
}

export default function SearchInput({ value, onChange, placeholder, infoText, className }: Props) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-white/4 py-2.5 pl-9 pr-10 text-sm text-white placeholder-white/30 outline-none transition focus:border-purple-400/60 focus:bg-white/6 focus:ring-2 focus:ring-purple-500/20"
      />
      <span className="group absolute right-2 top-1/2 -translate-y-1/2">
        <button
          type="button"
          aria-label="Search help"
          className="flex h-5 w-5 items-center justify-center rounded-full border border-white/15 text-[10px] font-semibold text-white/50 transition hover:border-white/30 hover:text-white/80 focus:border-purple-400/60 focus:text-white/90 focus:outline-none"
        >
          i
        </button>
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-white/10 bg-[#11111a] px-3 py-2 text-xs leading-relaxed text-white/70 opacity-0 shadow-lg shadow-black/40 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          {infoText}
        </span>
      </span>
    </div>
  )
}
