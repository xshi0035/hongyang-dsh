import type { IconProps } from './icons/props.ts'

/** Native viewBox of the RSUN mark (portrait, user units). Traced from docs/hongyang/brand/rsun-logo.png. */
export const FISH_LOGO_VIEWBOX = { width: 197, height: 260 }

/** RSUN striped-R mark outline; the historical export name is kept so consumers need no change. */
export const FISH_LOGO_PATH = 'M37 1L3 5L0 6L0 13L123 13L100 6L69 2L69 1ZM0 18L0 30L156 30L138 18ZM68 36L80 40L88 44L92 48L171 48L163 36ZM99 53L103 60L104 66L178 66L178 62L174 53ZM104 71L101 83L179 83L179 71ZM96 89L86 101L174 101L177 93L177 89ZM79 106L62 117L61 119L163 119L170 109L170 106ZM48 124L28 132L30 136L148 136L158 124ZM37 142L46 154L125 154L136 146L139 142ZM52 159L52 161L60 172L129 172L115 159ZM64 177L71 189L147 189L136 177ZM75 195L81 207L163 207L154 195ZM84 212L89 225L175 225L175 223L167 212ZM92 230L96 242L187 242L180 232L180 230ZM98 248L102 260L197 260L191 248Z'

/** Brand red sampled from the source artwork. */
export const HONGYANG_BRAND_RED = '#e40038'

/**
 * Render the RSUN brand mark.
 * @param props.size - height in px (default 24; width follows the 197:260 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * FISH_LOGO_VIEWBOX.width) / FISH_LOGO_VIEWBOX.height}
      height={size}
      className={className}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path id="hy-mark" d={FISH_LOGO_PATH} fill={HONGYANG_BRAND_RED} />
    </svg>
  )
}
