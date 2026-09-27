// 실제 호출 화면을 기준으로 한 표시 면 인벤토리. radius 순서 = TL, TR, BR, BL.
// computed/이미지는 브라우저에서만 채운다. 여기 숫자는 기존 CSS로부터의 기대값이다.
const surfaces = [
  ['student-edit', '/students', 'StudentModal.tsx:106', '학생 추가 / 학생360·상세 → 학생 정보 수정', 'sheet', ['form','long','expanded'], 'AnimatedModal 패널 / 내부 overflow-y-auto', 'date native'],
  ['student-detail', '/payments', 'StudentDetailModal.tsx:236', '학생 이름', 'sheet', ['loading','content','long','expanded'], 'AnimatedModal 패널 / 내부 overflow-y-auto', 'StudentModal, PaymentModal, DayOfMonthPicker, DatePickerPopup'],
  ['payment', '/students/paper-1', 'PaymentModal.tsx:301', '납부 기록', 'sheet', ['create','existing','long','expanded'], 'AnimatedModal 패널 / 내부 overflow-y-auto', '미디어 확대(포털), 인라인 삭제 확인'],
  ['bill-send', '/payments', 'BillSendModal.tsx:150', '미발송 청구 아이콘', 'center', ['idle','confirming','sending','success','scheduled','error'], '자식 data-paper-card(자체 overflow-y-auto)', '없음'],
  ['bill-action', '/payments', 'BillActionModal.tsx:297', '발송됨 청구 아이콘', 'center', ['idle','configuring-split','composing-sms','confirming-sms','confirming','submitting','done','error'], '자식 data-paper-card / 문자미리보기 내부 스크롤', '인라인 확인'],
  ['bulk-send', '/payments', 'BulkBillSendModal.tsx:52', '청구지연 필터 → 일괄 배지', 'center', ['confirm','sending','done','error','long'], '자식 data-paper-card / flex 본문·대상명단 스크롤', '없음'],
  ['bulk-resend', '/payments', 'BulkBillSendModal.tsx:52', '재발송 배지', 'center', ['confirm','sending','done','error','long'], '자식 data-paper-card / flex 본문·대상명단 스크롤', '없음'],
  ['quick', '/billing', 'QuickBillSendModal.tsx:198', '청구서 발송', 'center', ['form','confirming','sending','success','scheduled','error','long'], '자식 data-paper-card / flex 본문 스크롤', '과목·학년·반 피커'],
  ['quick-subject', '/billing', 'QuickBillSendModal.tsx:680', '청구서 발송 → 과목', 'popup', ['open','internal-scroll','resize','selected'], '피커 카드 / 위치 래퍼 투명(추가 radius 없음)', '부모 Quick'],
  ['quick-grade', '/billing', 'QuickBillSendModal.tsx:680', '과목 선택 → 학년', 'popup', ['open','internal-scroll','selected'], '피커 카드 / 위치 래퍼 투명', '부모 Quick'],
  ['quick-class', '/billing', 'QuickBillSendModal.tsx:680', '학년 선택 → 반', 'popup', ['open','internal-scroll','selected'], '피커 카드 / 위치 래퍼 투명', '부모 Quick'],
  ['day-of-month', '/payments', 'DayOfMonthPicker.tsx:20', '학생 상세 → 정규/선택 결제일', 'center', ['open','selected','clear'], 'data-paper-card / 외곽 padding', '부모 StudentDetail'],
  ['payment-days', '/payments', 'payments/PaymentDayFilterPicker.tsx:75', '헤더 결제일 선택', 'center', ['open','range','overdue','apply','clear'], 'dialog 자체 data-paper-card', '없음'],
  ['date', '/payments', 'payments/DatePickerPopup.tsx:56', '미납 행 펼침 → 결제일', 'popup', ['open','month','selected'], 'dialog 자체 배경 / 스크롤 없음', '학생상세·360 퇴원·환불·WithdrawAction에서도 호출'],
  ['method-pills', '/payments', 'payments/MethodPickerPopup.tsx:37', '미납 행 펼침 → 결제수단', 'pills', ['open','selected'], '각 option 별 rounded-full / 묶음 투명', 'special 정규·그룹 수납에도 호출(선택 자체가 쓰기)'],
  ['withdrawal', '/payments', 'WithdrawActionMenu.tsx:242', '퇴원생 이름', 'attached', ['open','long','date'], '표시 카드 overflow-hidden / 별도 문서 스크롤 없음', 'DatePickerPopup; 자동 dryRun POST는 합성 응답만'],
  ['settings-transfer', '/settings', '../app/settings/page.tsx:667', '학년 펼침 → 학생 반이동', 'attached', ['open','long','selected'], 'data-paper-card / flex 본문 overflow-y-auto', '없음'],
  ['settings-logs', '/settings', '../app/settings/page.tsx:759', '변경 로그', 'attached', ['loading','content','long','error'], 'data-paper-card / flex 본문 overflow-y-auto', '없음'],
  ['notice-covers', '/notice', '../app/notice/page.tsx:927', '이미지 → 교재 표지', 'center', ['loading','content','long','empty'], '떠 있는 data-paper-card(p-4 바깥 여백) / flex 명단', '없음'],
  ['notice-confirm', '/notice', '../app/notice/page.tsx:990', '합성 대상·내용 선택 → 발송 전 확인', 'center', ['open','long'], '떠 있는 data-paper-card / 수신자 미리보기', '최종 발송 버튼은 누르지 않음'],
  ['special-receipt', '/special', '../app/special/page.tsx:860', '영수증 N장 보기', 'sheet', ['loading','content','long','empty','expanded'], 'AnimatedModal 패널 / 내부 overflow-y-auto', '확대 이미지'],
  ['special-zoom', '/special', '../app/special/page.tsx:924', '영수증 보기 → 이미지', 'image', ['open'], 'img.rounded-xl / 공용 중앙 래퍼는 투명', '부모 영수증 시트'],
  ['payment-image', '/students/paper-1', 'PaymentModal.tsx:690', '기존 납부 → 영수증 사진', 'fullscreen', ['open'], '전체화면 미디어 스크림·이미지(직각 허용)', '부모 PaymentModal'],
  ['student360-withdraw', '/students/paper-1', '../app/students/[id]/page.tsx:422', '퇴원 처리', 'transparent', ['open','date'], '투명 래퍼 / 날짜·확인 버튼 각각 기존 radius', 'DatePickerPopup(새 카드 배경 금지)'],
  ['install', '/dashboard', 'InstallPrompt.tsx:152', '합성 beforeinstallprompt / iOS 안내', 'center', ['android','ios'], 'dialog > div 카드 / 래퍼 pointer-events-none', 'login·kiosk 숨김 보존'],
  ['toast', '/payments', 'PaperToaster.tsx:9', '합성 오류 알림', 'center', ['error','close'], 'Sonner toast 자체 / 닫기 버튼 밖으로 돌출 허용', '외곽 overflow-hidden 금지'],
  ['floating-toolbar', '/payments', '../app/payments/page.tsx:2510', '행 메모 스와이프 두 개 선택', 'popup', ['open','scroll'], '툴바 자체 rounded-xl', '행 transform/touchAction 변경 금지'],
]
const excluded = [
  ['login', 'src/app/login/page.tsx:36', '뷰포트에 붙는 전체화면, 모달 아님'],
  ['kiosk-confirm', 'src/app/kiosk/page.tsx:573', 'role=status 인라인 수업일 확인, 대화상자 아님. 8초 만료·다크 토큰 유지'],
  ['kiosk-success/error', 'src/app/kiosk/page.tsx:594', '한 화면 안 mode 교체, 별도 부유 표시 면 없음'],
  ['agent-bubble', 'src/app/agent/page.tsx:135', '말풍선 꼬리 의도'],
  ['salary-footer', 'src/app/teachers/[id]/page.tsx:474', '카드 하단 합계 띠, 독립 팝업 아님'],
  ['ai-filter', 'src/components/payments/AiFilterButton.tsx:303', '독립 알약 입력·입자·투명 SVG, 새 외곽 카드 금지'],
  ['native-dialog', 'window.confirm / input[type=date] / select / file', '브라우저·OS 소유 표면. 앱 CSS radius 비대상; 실기기 조작 검수는 별도'],
]
const viewports = [{ width: 412, height: 915 }, { width: 375, height: 667 }, { width: 820, height: 1180 }]
function pendingMatrix() {
  return surfaces.flatMap(([id, route, source, entry, rule, states, layers, nested]) => [...new Set([...states,'scroll-top','scroll-bottom'])].flatMap(state => viewports.map(viewport => ({
    id, route, source, entry, rule, state, layers, nested, viewport,
    before: { status: '미검증', radius: [null,null,null,null], corners: [null,null,null,null] },
    after: { status: '미검증', radius: [null,null,null,null], corners: [null,null,null,null] },
  }))))
}
module.exports = { surfaces, excluded, viewports, pendingMatrix }
