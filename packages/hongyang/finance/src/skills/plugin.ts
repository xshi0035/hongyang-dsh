/**
 * Bundled skill provider: the three business-rule skills shipped under
 * `skills/`, loaded on demand through the DSH skill registry. The frontmatter
 * of each `SKILL.md` supplies the description the catalog shows; the body is
 * what the model reads when it invokes the skill.
 * @module @deepseek-ai/dsh-hy-finance/skills/plugin
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider, type SkillResourceBase,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'hy-finance'
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** Skills shipped with the package, in catalog order. */
const SKILLS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: 'hy-finance',
    description: '衡阳弘阳广场（衡阳诚远商业管理有限公司）财务口径：22 个费项与列序、税率、预收与销项税科目、凭证摘要模板、收款渠道识别、日结拆分、认领与拆分规则、术语。处理银行流水、收款认领、收入日报表、凭证或欠费问题前先加载。',
  },
  {
    name: 'hy-daily-report',
    description: '收入日报表（34 列，一商户一笔收款一行）的生成、导出与和贺部长手工台账的逐行比对流程。生成或核对日报表时加载。',
  },
  {
    name: 'hy-voucher',
    description: '金蝶云星空 21 列凭证的行序、借贷方向、税额拆分、科目校验点，以及与客户人工凭证比对的方法。生成或核对凭证时加载。',
  },
]

function bodyUrl(name: string): URL {
  return new URL(`../skills/${name}/SKILL.md`, import.meta.url)
}

/** Directory of one skill's `SKILL.md`, the base for any resource it references. */
function resourceBase(name: string): SkillResourceBase {
  return { kind: 'directory', path: fileURLToPath(new URL(`../skills/${name}/`, import.meta.url)) }
}

function candidate(skill: { name: string; description: string }): SkillCandidate {
  return {
    name: skill.name,
    description: skill.description,
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: resourceBase(skill.name),
    rank: BUNDLED_SKILL_RANK,
    locator: bodyUrl(skill.name),
  }
}

/** Drop the YAML frontmatter block; the registry already carries name and description. */
function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown)
  return match === null ? markdown : markdown.slice(match[0].length)
}

const CANDIDATES = SKILLS.map(candidate)

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(CANDIDATES),
  async get(found): Promise<SkillDefinition | undefined> {
    const own = CANDIDATES.find(c => c.name === found.name)
    if (own === undefined) return undefined
    return {
      name: own.name,
      description: own.description,
      invocation: own.invocation,
      provider: own.provider,
      source: own.source,
      resourceBase: resourceBase(own.name),
      content: stripFrontmatter(await readFile(bodyUrl(own.name), 'utf8')),
    }
  },
}

/** Cordis plugin name. */
export const name = 'hy-finance-skills'
/** Required service. */
export const inject = ['skills']

/**
 * Register the bundled provider on `ctx.skills`.
 * @param ctx - context owning the registration.
 */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
