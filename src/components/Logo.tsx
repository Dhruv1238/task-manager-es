type Props = {
  className?: string
  height?: number
}

export default function Logo({ className, height = 40 }: Props) {
  return (
    <>
      <img
        src="/eventstrat-logo-full.svg"
        alt="Eventstrat"
        height={height}
        style={{ height }}
        className={`brightness-0 invert in-[.light]:hidden ${className ?? ''}`}
      />
      <img
        src="/eventstrat-logo-full-purple.svg"
        alt="Eventstrat"
        height={height}
        style={{ height }}
        className={`hidden in-[.light]:inline-block ${className ?? ''}`}
      />
    </>
  )
}
