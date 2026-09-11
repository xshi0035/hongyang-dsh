import type { IconProps } from './icons/props.ts'

/** Native viewBox of {@link FISH_LOGO_PATH} (width and height in user units). */
export const FISH_LOGO_VIEWBOX = { width: 24, height: 24 }

/**
 * Hongyang (RSUN) brand mark: a striped "R" in brand red. The export names keep the
 * historical fish identifiers so existing consumers (sidebar rail, hero) need no change.
 */
export const FISH_LOGO_PATH = 'M5.7 1.0L17.7 1.0L17 3.3L5 3.3ZM5.7 4.1L9.2 4.1L8.5 6.4L5 6.4ZM15.7 4.1L19.7 4.1L19 6.4L15 6.4ZM5.7 7.2L9.2 7.2L8.5 9.5L5 9.5ZM15.7 7.2L19.7 7.2L19 9.5L15 9.5ZM5.7 10.3L18.7 10.3L18 12.6L5 12.6ZM5.7 13.4L9.2 13.4L8.5 15.7L5 15.7ZM13.2 13.4L17.2 13.4L16.5 15.7L12.5 15.7ZM5.7 16.5L9.2 16.5L8.5 18.8L5 18.8ZM14.7 16.5L18.7 16.5L18 18.8L14 18.8ZM5.7 19.6L9.2 19.6L8.5 21.9L5 21.9ZM16.2 19.6L20.7 19.6L20 21.9L15.5 21.9Z'

/** Gradient id shared by every rendered mark on a page (identical definition, so duplicates are harmless). */
const MARK_GRADIENT_ID = 'hy-mark-grad'

/**
 * Render the Hongyang brand mark.
 * @param props.size - width in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={MARK_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff3b5c" />
          <stop offset="1" stopColor="#c40020" />
        </linearGradient>
      </defs>
      <path id="hy-mark" d={FISH_LOGO_PATH} fill={`url(#${MARK_GRADIENT_ID})`} />
    </svg>
  )
}
