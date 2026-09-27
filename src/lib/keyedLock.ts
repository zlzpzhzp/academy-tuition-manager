// Next의 서로 다른 route 번들도 같은 프로세스의 락을 공유한다. 다중 인스턴스용 DB 락은 아니다.
const processState = globalThis as typeof globalThis & { __tuitionKeyedLocks?: Map<string, Promise<void>> }
const locks = processState.__tuitionKeyedLocks ??= new Map<string, Promise<void>>()

/** 같은 키는 직렬, 다른 키는 병렬. waited는 기존 청구서를 교체하는 분할 요청의 동시 진입 판정용. */
export async function withKeyedLock<T>(key: string, fn: (waited: boolean) => Promise<T>): Promise<T> {
  const previous = locks.get(key)
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  locks.set(key, current)
  await previous
  try {
    return await fn(previous !== undefined)
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}
