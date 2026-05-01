type Props = {
  className?: string
  height?: number
}

export default function Logo({ className, height = 40 }: Props) {
  return (
    <img
      src="/eventstrat-logo-full.svg"
      alt="Eventstrat"
      height={height}
      style={{ height }}
      className={className}
    />
  )
}