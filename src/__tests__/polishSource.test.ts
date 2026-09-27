import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { copyCandidate, sourceIdentity } from '../../tests/e2e/support/polish-source.mjs'
import { it, expect } from 'vitest'

it('격리 후보는 삭제를 건너뛰고 신규/수정 실제 입력을 해시에 포함한다', async () => {
  const dir = await mkdtemp('/tmp/tuition-polish-source-')
  try {
    await mkdir(`${dir}/repo`); await mkdir(`${dir}/candidate`)
    await writeFile(`${dir}/repo/new.ts`, '신규'); await writeFile(`${dir}/repo/.env.local`, '합성 제외 표본')
    const run = async () => {
      await copyCandidate(`${dir}/repo`, `${dir}/candidate`, ['deleted.ts', 'new.ts', 'new-second.ts', '.env.local'])
      return sourceIdentity(`${dir}/candidate`)
    }
    const first = await run(); expect(first.sourceFiles).toEqual(['new.ts'])
    expect(await readFile(`${dir}/candidate/new.ts`, 'utf8')).toBe('신규')
    await writeFile(`${dir}/repo/new.ts`, '수정')
    expect((await run()).sourceHash).not.toBe(first.sourceHash)
    expect((await run()).sourceHash).toBe((await run()).sourceHash)
    const beforeNew = (await run()).sourceHash
    await writeFile(`${dir}/repo/new-second.ts`, '후보에서만 추가')
    const afterNew = await run()
    expect(afterNew.sourceHash).not.toBe(beforeNew)
    expect(afterNew.sourceFiles).toEqual(['new-second.ts','new.ts'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
