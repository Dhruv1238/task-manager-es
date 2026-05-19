import type { CSSProperties } from 'react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import './KiethAI.css'

type KiethAIProps = {
  size?: number
  className?: string
}

export const KiethAI = ({ size = 200, className }: KiethAIProps) => (
  <div
    className={['kieth-ai', className].filter(Boolean).join(' ')}
    style={{ '--kieth-size': `${size}px` } as CSSProperties}
    aria-hidden="true"
  >
    <img
      className="kieth-ai__bubble"
      src="/kieth-ai-bubble.png"
      alt=""
      draggable={false}
    />
    <DotLottieReact
      className="kieth-ai__lottie"
      src="/kieth-ai.lottie"
      loop
      autoplay
    />
  </div>
)

export default KiethAI
