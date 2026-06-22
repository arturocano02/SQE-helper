/**
 * Unit tests for the deterministic, no-AI parts of the chunk-extraction pipeline:
 * splitContentIntoUnits (Stage 2 splitting) and flattenToLeaves (Stage 1 tree flattening).
 *
 * Why these two and not parseDocxToSections: parseDocxToSections needs a real OOXML document
 * to exercise meaningfully, which is what the live /api/admin/chunks/verify and /preview
 * routes already do against the actual uploaded files (re-parse + diff against the DB) — that
 * integration-level check is a better tool for "did this real document get fully read" than a
 * synthetic docx built by hand here ever could be. What unit tests CAN check cheaply and
 * reliably, on every commit, with no DB and no file at all, is the invariant that most directly
 * caused the original "88% of the document silently dropped" bug: every character of input
 * content that isn't deliberately discarded as noise must show up in the output. These tests
 * encode that invariant directly, so a future change to the splitting/flattening logic that
 * breaks it fails the test suite immediately instead of being discovered by chance.
 */

import { describe, it, expect } from 'vitest'
import { splitContentIntoUnits, flattenToLeaves, breadcrumbFor, type DocSection } from './chunk-extractor'

describe('splitContentIntoUnits', () => {
  it('keeps a single prose paragraph as one unit, verbatim', () => {
    const content = 'A contract is formed when offer meets acceptance, supported by consideration.'
    const units = splitContentIntoUnits(content)
    expect(units).toEqual([content])
  })

  it('splits a pure list into one unit per item', () => {
    const content = [
      'The exceptions to the postal rule are:',
      '- the offeror has excluded it',
      '- the letter was not properly stamped and addressed',
      '- it would produce a manifest absurdity',
    ].join('\n')
    // Mixed (prose header + list) → kept together as ONE unit, since the prose provides
    // context the list items would lose standing alone.
    const units = splitContentIntoUnits(content)
    expect(units).toHaveLength(1)
    expect(units[0]).toContain('manifest absurdity')
  })

  it('splits a block that is ONLY list items into one unit per item', () => {
    const content = [
      '- offer and acceptance',
      '- consideration',
      '- intention to create legal relations',
    ].join('\n')
    const units = splitContentIntoUnits(content)
    expect(units).toEqual([
      '- offer and acceptance',
      '- consideration',
      '- intention to create legal relations',
    ])
  })

  it('keeps a markdown table as a single whole unit', () => {
    const content = [
      '| Term | Meaning |',
      '|------|---------|',
      '| Offer | A statement of willingness to contract |',
      '| Acceptance | Unqualified assent to the offer |',
    ].join('\n')
    const units = splitContentIntoUnits(content)
    expect(units).toHaveLength(1)
    expect(units[0]).toBe(content)
  })

  it('preserves every block in document order across multiple paragraphs', () => {
    const content = [
      'First rule: an offer can be revoked any time before acceptance.',
      'Second rule: revocation must be communicated to be effective.',
      'Third rule: a unilateral offer cannot be revoked once performance has begun.',
    ].join('\n\n')
    const units = splitContentIntoUnits(content)
    expect(units).toHaveLength(3)
    expect(units[0]).toContain('First rule')
    expect(units[1]).toContain('Second rule')
    expect(units[2]).toContain('Third rule')
  })

  it('does not silently drop a long document — every non-trivial block survives', () => {
    // Regression guard for the real bug this whole feature was built to catch: a document
    // that "extracts successfully" while actually losing most of its content. Build a longer
    // multi-paragraph block and assert nothing meaningful is lost in the round-trip.
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Rule ${i + 1}: this is a distinct legal principle about topic number ${i + 1} that must survive splitting.`
    )
    const content = paragraphs.join('\n\n')
    const units = splitContentIntoUnits(content)
    expect(units).toHaveLength(20)
    for (let i = 0; i < 20; i++) {
      expect(units[i]).toBe(paragraphs[i])
    }
  })

  it('drops only genuinely trivial fragments (under the noise floor), not real short rules', () => {
    const content = ['ok', 'A minor must be under 18 years of age.'].join('\n\n')
    const units = splitContentIntoUnits(content)
    // "ok" (2 chars) is below the 5-char block floor and is correctly discarded as noise.
    expect(units).toEqual(['A minor must be under 18 years of age.'])
  })
})

describe('breadcrumbFor', () => {
  it('joins the path with " > " and appends the page number when present', () => {
    expect(breadcrumbFor({ path: ['Contract', 'Formation', 'Offer'], firstPage: 12 }))
      .toBe('Contract > Formation > Offer (p. 12)')
  })

  it('omits the page suffix when firstPage is null', () => {
    expect(breadcrumbFor({ path: ['Contract', 'Formation'], firstPage: null }))
      .toBe('Contract > Formation')
  })
})

function section(partial: Partial<DocSection> & { title: string; path: string[] }): DocSection {
  return {
    level: 1,
    content: '',
    children: [],
    firstPage: null,
    ...partial,
  }
}

describe('flattenToLeaves', () => {
  it('returns a leaf for every childless section that has content', () => {
    const tree: DocSection[] = [
      section({ title: 'Formation', path: ['Contract', 'Formation'], content: 'Rule about offer and acceptance.' }),
      section({ title: 'Terms', path: ['Contract', 'Terms'], content: 'Rule about implied terms.' }),
    ]
    const leaves = flattenToLeaves(tree)
    expect(leaves).toHaveLength(2)
    expect(leaves.map(l => l.content)).toEqual([
      'Rule about offer and acceptance.',
      'Rule about implied terms.',
    ])
  })

  it('skips structural nodes that have neither content nor children', () => {
    const tree: DocSection[] = [
      section({ title: 'Empty heading', path: ['Contract', 'Empty heading'], content: '' }),
      section({ title: 'Real section', path: ['Contract', 'Real section'], content: 'Actual rule text.' }),
    ]
    const leaves = flattenToLeaves(tree)
    expect(leaves).toHaveLength(1)
    expect(leaves[0].content).toBe('Actual rule text.')
  })

  it('does not lose intro text that sits above child sections (emits it as a virtual leaf)', () => {
    // This is the exact shape of bug the comment in flattenToLeaves warns about: a parent
    // section with its own content AND children must emit both, not just recurse into
    // children and drop its own text.
    const tree: DocSection[] = [
      section({
        title: 'Termination',
        path: ['Contract', 'Termination'],
        content: 'Intro: termination ends the contract for the future only.',
        children: [
          section({ title: 'Repudiatory breach', path: ['Contract', 'Termination', 'Repudiatory breach'], content: 'A serious breach allows termination.' }),
        ],
      }),
    ]
    const leaves = flattenToLeaves(tree)
    expect(leaves).toHaveLength(2)
    expect(leaves.some(l => l.content.includes('Intro: termination'))).toBe(true)
    expect(leaves.some(l => l.content.includes('A serious breach'))).toBe(true)
  })

  it('recurses through multiple levels without losing any leaf', () => {
    const tree: DocSection[] = [
      section({
        title: 'Trusts',
        path: ['Trusts'],
        content: '',
        children: [
          section({
            title: 'Express trusts',
            path: ['Trusts', 'Express trusts'],
            content: '',
            children: [
              section({ title: 'Three certainties', path: ['Trusts', 'Express trusts', 'Three certainties'], content: 'Certainty of intention, subject matter, and objects.' }),
              section({ title: 'Constitution', path: ['Trusts', 'Express trusts', 'Constitution'], content: 'A trust must be constituted to be enforceable.' }),
            ],
          }),
        ],
      }),
    ]
    const leaves = flattenToLeaves(tree)
    expect(leaves).toHaveLength(2)
    expect(leaves.map(l => l.title).sort()).toEqual(['Constitution', 'Three certainties'])
  })

  it('coverage invariant: total leaf characters never exceed total source characters, and every leaf with content is accounted for', () => {
    // A generic guard against the class of bug this feature targets: build a moderately deep
    // tree and assert flattening never invents content and never silently skips a non-empty
    // node (every node with content ends up inside exactly one leaf's .content).
    const tree: DocSection[] = Array.from({ length: 5 }, (_, i) =>
      section({
        title: `Chapter ${i}`,
        path: [`Chapter ${i}`],
        content: `Intro text for chapter ${i}.`,
        children: Array.from({ length: 3 }, (_, j) =>
          section({
            title: `Section ${i}.${j}`,
            path: [`Chapter ${i}`, `Section ${i}.${j}`],
            content: `Body text for section ${i}.${j}.`,
          })
        ),
      })
    )
    const leaves = flattenToLeaves(tree)
    // 5 chapter intros + 5*3 sub-sections = 20 leaves
    expect(leaves).toHaveLength(20)
    const totalSourceChars =
      tree.reduce((sum, ch) => sum + ch.content.length, 0) +
      tree.reduce((sum, ch) => sum + ch.children.reduce((s, c) => s + c.content.length, 0), 0)
    const totalLeafChars = leaves.reduce((sum, l) => sum + l.content.length, 0)
    expect(totalLeafChars).toBe(totalSourceChars)
  })
})
