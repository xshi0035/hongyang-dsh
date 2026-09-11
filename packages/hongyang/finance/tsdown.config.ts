import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-hy-finance',
  ['lib/types/index.js'],
  { hostPhase: true },
)
