import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, readlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const excluded = file => /(^|\/)(?:\.env[^/]*|node_modules|\.git|\.next[^/]*)(?:\/|$)/.test(file)

export async function copyCandidate(repo, dir, files) {
  for (const file of new Set(files)) {
    if (!file || excluded(file)) continue
    try { await lstat(join(repo, file)) } catch (error) {
      if (error.code === 'ENOENT') continue // 미커밋 삭제는 후보 입력에 없다.
      throw error
    }
    await mkdir(dirname(join(dir, file)), { recursive: true })
    await cp(join(repo, file), join(dir, file), { dereference: false })
  }
}

/** 복사가 끝난 실제 입력 전부(신규 포함). 생성물·모듈 링크를 만들기 전에 호출한다. */
export async function sourceIdentity(dir) {
  const files = []
  async function walk(prefix = '') {
    for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
      const file = prefix ? `${prefix}/${entry.name}` : entry.name
      if (excluded(file)) continue
      if (entry.isDirectory()) await walk(file)
      else files.push(file)
    }
  }
  await walk()
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    const path = join(dir, file), stat = await lstat(path)
    const contents = stat.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path)
    hash.update(`${file}\0${stat.isSymbolicLink() ? 'link' : 'file'}\0${contents.length}\0`).update(contents)
  }
  return { sourceHash: hash.digest('hex'), sourceFiles: files }
}
