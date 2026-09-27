/** 기준/후보 정식 격리 빌드. 공유 node_modules·운영 .next·환경파일을 수정하지 않는다. */
import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { copyCandidate, sourceIdentity } from './polish-source.mjs'

const repo = resolve(import.meta.dirname, '../../..')
const phase = process.argv[2]
assert(['base', 'candidate', 'serve-base', 'serve-candidate'].includes(phase), 'node tests/e2e/support/polish-build.mjs base|candidate|serve-base|serve-candidate')
const baseSha = process.env.POLISH_SHA
assert(baseSha && /^[a-f0-9]{40}$/.test(baseSha), 'POLISH_SHA에 이번 착수 HEAD 40자리 SHA를 명시')
const output = resolve(process.env.POLISH_BUILDS || '/tmp/tuition-polish-replay')
assert(output.startsWith('/tmp/tuition-polish-'), '전용 /tmp/tuition-polish-*만 허용')
const kind = phase.replace('serve-', '')
const dir = `${output}/${kind}`
const port = kind === 'base' ? 3381 : 3382
const env = {
  PATH: process.env.PATH, HOME: output, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'polish-synthetic-unused-key',
  SESSION_SECRET: 'polish-synthetic-session-only', ADMIN_ID: 'synthetic-admin',
}
await mkdir(output, { recursive: true })
const run = (args, logName) => new Promise((resolveRun, reject) => {
  const log = createWriteStream(`${output}/${logName}`)
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log); child.stderr.pipe(log)
  child.on('error', reject)
  child.on('close', code => { log.end(); resolveRun(code ?? 1) })
})
if (phase.startsWith('serve-')) {
  const manifest = JSON.parse(await readFile(`${output}/${kind}.json`, 'utf8'))
  assert.equal(manifest.buildExit, 0, '실패한 빌드는 서빙하지 않는다')
  const code = await run(['start', '--hostname', '127.0.0.1', '--port', String(port)], `${kind}-server.log`)
  process.exitCode = code
} else {
  // 같은 경로의 실행 중인 서버를 덮지 않게 항상 새 출력 디렉터리를 요구한다.
  await mkdir(dir)
  const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 30 }) // git archive 는 기본 1MB 버퍼를 넘긴다(ENOBUFS)
  const status = git(['status', '--short']).toString()
  const head = git(['rev-parse', 'HEAD']).toString().trim()
  if (kind === 'base') {
    const archive = git(['archive', baseSha])
    execFileSync('tar', ['-x', '-C', dir], { input: archive })
  } else {
    // 후보가 커밋되면 HEAD≠기준 SHA 가 정상이다(review-diff 141942 P2). 기준과 후보 식별은 manifest 의 head/sourceHash 로 남긴다.
    if (head !== baseSha) console.warn(`[polish-build] candidate HEAD ${head} ≠ base ${baseSha} (커밋된 후보)`)
    const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean)
    await copyCandidate(repo, dir, files)
  }
  const identity = { baseSha, head, status, ...await sourceIdentity(dir), port, kind, createdAt: new Date().toISOString(), attempts: [] }
  await writeFile(`${output}/${kind}.json`, JSON.stringify(identity, null, 2))
  const modules = await realpath(`${repo}/node_modules`)
  await symlink(modules, `${dir}/node_modules`, 'dir')
  let code = await run(['build', '--webpack'], `${kind}-webpack.log`)
  identity.attempts.push({ builder: 'webpack', exit: code })
  if (code !== 0) {
    // 검수 보강: 원본 설치본을 복사한 격리 디렉터리에서만 turbopack을 시도한다.
    // .next는 이 스크립트가 방금 만든 후보 것뿐이다. 어떤 검증기도 끄지 않는다.
    await rm(`${dir}/node_modules`)
    await cp(modules, `${dir}/node_modules`, { recursive: true })
    await rm(`${dir}/.next`, { recursive: true, force: true })
    code = await run(['build'], `${kind}-turbopack.log`)
    identity.attempts.push({ builder: 'turbopack', exit: code })
  }
  identity.buildExit = code
  await writeFile(`${output}/${kind}.json`, JSON.stringify(identity, null, 2))
  console.log(JSON.stringify(identity))
  process.exitCode = code
}
