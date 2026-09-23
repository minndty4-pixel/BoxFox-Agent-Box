/**
 * P5.3 — Nhãn của app đi theo **ngôn ngữ câu trả lời**.
 *
 * Mặt câu trả lời cuối không còn chữ nào do app viết (P4.2), nên ngôn ngữ câu trả lời chỉ còn ảnh
 * hưởng tới những chỗ app viết chữ QUANH lượt: chú thích ảnh trong timeline (`captionKind`, P4.3) và
 * dòng biên nhận ở đầu lượt (`activityReceipt`). Hai chỗ ấy không có câu trả lời thì rơi về từ điển
 * của ngôn ngữ giao diện (`en`) — lượt cũ và lượt đang chạy không tự nhận mình là tiếng Việt.
 *
 * KHÔNG đụng tới ngôn ngữ giao diện (`i18n/index.tsx` vẫn giữ `useState<Lang>('en')`) và không thêm
 * công tắc ngôn ngữ nào: đây chỉ là một hàm tra từ điển thứ hai, không phải một chế độ.
 */
import { useMemo } from 'react'
import { DICTS } from './dicts'
import { answerLang } from './answerLang'
import { labelFrom, type Lang, type TKey, type TVars } from './context'

export interface AnswerLabels {
  /** Ngôn ngữ đã nhận ra của chính câu trả lời (`en` khi không có gì rõ ràng). */
  lang: Lang
  /** Tra từ điển theo ngôn ngữ ấy; thiếu khoá thì rơi về tiếng Việt rồi trả lại chính khoá. */
  tLabel: (key: TKey, vars?: TVars) => string
}

export function useAnswerLabels(text: string | null | undefined): AnswerLabels {
  const lang = useMemo(() => answerLang(text), [text])
  return useMemo(() => {
    const dict = DICTS[lang]
    return {
      lang,
      tLabel: (key: TKey, vars?: TVars) => labelFrom(dict, key, vars),
    }
  }, [lang])
}
