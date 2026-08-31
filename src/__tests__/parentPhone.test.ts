import { describe, it, expect } from 'vitest'
import { parentPhone, billingPhone } from '@/lib/student-codes'

// 2026-08-11 백종원: parent_phone(어머니)이 비어 있고 아버님이 수신자였는데, 학부모 연락 경로가
// parent_phone 만 보는 바람에 그 학생만 통째로 빠졌다. 데이터는 멀쩡했고 읽는 쪽이 틀렸다.
describe('parentPhone — 학부모 번호 판정(학생 폴백 없음)', () => {
  const father = '010-0000-0011'
  const mother = '010-1111-2222'
  const student = '010-0000-0012'

  it('아버님 수신 + 어머니 없음 → 아버님 번호 (백종원 케이스)', () => {
    expect(parentPhone({ parent_phone: '', parent_father_phone: father, payssam_recipient: 'father' })).toBe(father)
  })

  it('아버님 수신 + 둘 다 있음 → 고른 쪽(아버님)을 존중', () => {
    expect(parentPhone({ parent_phone: mother, parent_father_phone: father, payssam_recipient: 'father' })).toBe(father)
  })

  it('어머니 수신(기본) → 어머니 번호', () => {
    expect(parentPhone({ parent_phone: mother, parent_father_phone: father, payssam_recipient: 'mother' })).toBe(mother)
  })

  it('어머니 수신인데 어머니 번호가 없으면 아버님으로 — 안내가 통째로 빠지는 것보다 낫다', () => {
    expect(parentPhone({ parent_phone: '', parent_father_phone: father, payssam_recipient: 'mother' })).toBe(father)
  })

  it('학부모 번호가 하나도 없으면 빈 문자열 — 학생 본인 번호로 새지 않는다', () => {
    expect(parentPhone({ parent_phone: '', parent_father_phone: '', payssam_recipient: 'mother' })).toBe('')
  })

  it('billingPhone 과의 차이: 청구 경로는 학생 번호로 폴백하지만 학부모 경로는 안 한다', () => {
    const noParent = { parent_phone: '', parent_father_phone: '', phone: student, payssam_recipient: 'mother' as const }
    expect(billingPhone(noParent)).toBe(student)
    expect(parentPhone(noParent)).toBe('')
  })
})
