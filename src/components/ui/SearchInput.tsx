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
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
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
        className="w-full rounded-lg border border-line bg-fill-2 py-2.5 pl-9 pr-10 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring"
      />
      <span className="group absolute right-2 top-1/2 -translate-y-1/2">
        <button
          type="button"
          aria-label="Search help"
          className="flex h-5 w-5 items-center justify-center rounded-full border border-line-strong text-[10px] font-semibold text-fg-subtle transition hover:border-brand-edge hover:text-fg-strong focus:border-brand-edge focus:text-fg-strong focus:outline-none"
        >
          i
        </button>
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute right-0 top-full z-10 mt-2 w-64 rounded-lg border border-line bg-overlay px-3 py-2 text-xs leading-relaxed text-fg-muted opacity-0 shadow-lg shadow-black/40 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          {infoText}
        </span>
      </span>
    </div>
  )
}
