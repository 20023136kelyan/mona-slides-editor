import type { PPTAudioElement, PPTVideoElement } from '@mona/presentation-core/model'

function PlayIcon() {
  return (
    <svg aria-hidden="true" className="mona-video-icon" viewBox="0 0 48 48">
      <path d="M15 24V11.876l10.5 6.062L36 24l-10.5 6.062L15 36.124z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="4" />
    </svg>
  )
}

function VolumeIcon() {
  return (
    <svg aria-hidden="true" className="mona-audio-icon" viewBox="0 0 48 48">
      <g fill="none" stroke="currentColor" strokeWidth="4">
        <path d="M24 6v36c-7 0-12.201-9.16-12.201-9.16H6a2 2 0 0 1-2-2V17.01a2 2 0 0 1 2-2h5.799S17 6 24 6Z" strokeLinejoin="round" />
        <path d="M32 15a12 12 0 0 1 1.684 1.859A12.07 12.07 0 0 1 36 24c0 2.654-.846 5.107-2.278 7.09A12 12 0 0 1 32 33" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M34.236 41.186C40.084 37.696 44 31.305 44 24c0-7.192-3.796-13.496-9.493-17.02" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export function VideoElement({ element }: { element: PPTVideoElement }) {
  return (
    <div
      className="mona-element mona-video-element"
      data-element-id={element.id}
      data-element-type="video"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div className="mona-video-content" style={{ backgroundImage: element.poster ? `url(${element.poster})` : '' }}>
          <PlayIcon />
        </div>
      </div>
    </div>
  )
}

export function AudioElement({ element }: { element: PPTAudioElement }) {
  const size = Math.min(element.width, element.height)
  return (
    <div
      className="mona-element mona-audio-element"
      data-element-id={element.id}
      data-element-type="audio"
      style={{ top: element.top, left: element.left, width: element.width, height: element.height }}
    >
      <div className="mona-rotate-wrapper" style={{ transform: `rotate(${element.rotate}deg)` }}>
        <div className="mona-audio-content" style={{ color: element.color }}>
          <span style={{ display: 'block', height: size, width: size }}><VolumeIcon /></span>
        </div>
      </div>
    </div>
  )
}
