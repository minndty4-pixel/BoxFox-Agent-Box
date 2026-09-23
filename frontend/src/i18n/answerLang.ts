/**
 * P5.1 — Bộ nhận diện ngôn ngữ nhẹ cho CHÍNH câu trả lời của model.
 *
 * Vì sao cần: nhãn do app viết quanh lượt (chú thích ảnh trong timeline, dòng biên nhận ở đầu lượt)
 * phải đi theo ngôn ngữ câu trả lời (D-24), mà app chỉ có một ngôn ngữ giao diện (`en`). Hàm này
 * đọc **chữ của model** để chọn từ điển, không sửa một ký tự nào của chữ ấy.
 *
 * Cách đếm: hai tín hiệu —
 *   (a) chữ Latin có dấu (bao trùm đủ bộ chữ tiếng Việt: `ă â đ ê ô ơ ư` và mọi chữ mang thanh
 *       điệu như `ử ạ ế ở`) cùng các dấu tổ hợp rời của bộ gõ — 1 điểm mỗi ký tự;
 *   (b) từ dừng tiếng Việt KHÔNG dấu (`khong, duoc, cua, nay, va, mot, nhu, thi, cho`) trên ranh
 *       giới từ — 1 điểm mỗi từ, để câu tiếng Việt gõ không dấu vẫn nhận ra được.
 * Điểm tiếng Việt ≥ `ANSWER_LANG_MIN_SCORE` VÀ lớn hơn điểm tiếng Anh thì mới là `vi`; còn lại là
 * `en` (mặc định an toàn: câu trộn hai thứ tiếng, toàn code, hoặc rỗng đều về `en`).
 */
import type { Lang } from './context'

/**
 * Ngưỡng điểm tối thiểu để một câu trả lời được coi là tiếng Việt. Ba điểm — đủ để một câu tiếng
 * Anh lỡ chứa một hai từ tiếng Việt không dấu (tên tệp, tên người) không thành tiếng Việt.
 */
export const ANSWER_LANG_MIN_SCORE = 3

/**
 * Chữ Latin có dấu. Bao trùm toàn bộ chữ cái tiếng Việt (Latin-1 + Latin Extended-A cho `ă â đ ê ô
 * ơ ư`, Latin Extended Additional U+1EA0–U+1EF9 cho các chữ mang thanh điệu), cộng dấu tổ hợp rời
 * mà bộ gõ có thể để lại trên chuỗi (U+0300 … U+0323).
 *
 * Hai lớp ký tự tách rời nhau (khớp y hệt một lớp gộp) vì `no-misleading-character-class` của eslint
 * từ chối một lớp vừa có dấu tổ hợp vừa có chữ — dấu tổ hợp đứng cạnh chữ khác là chỗ dễ đọc sai.
 */
const ACCENTED_LETTERS = /[\u00C0-\u024F\u1E00-\u1EFF]|[\u0300-\u0323]/g

/** Từ dừng tiếng Việt không dấu — chữ thường, đứng riêng một từ. */
const VIETNAMESE_STOP_WORDS = ['khong', 'duoc', 'cua', 'nay', 'va', 'mot', 'nhu', 'thi', 'cho']

/** Từ dừng tiếng Anh hay gặp trong câu trả lời của agent — để không đoán `vi` khi câu là tiếng Anh. */
const ENGLISH_STOP_WORDS = [
  'the',
  'and',
  'with',
  'this',
  'that',
  'for',
  'was',
  'are',
  'not',
  'you',
  'your',
  'from',
  'have',
  'has',
  'what',
  'when',
  'which',
  'there',
  'then',
  'than',
]

const STOP_WORD_PATTERNS = new Map<string, RegExp>()

function stopWordScore(text: string, words: readonly string[]): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const word of words) {
    let pattern = STOP_WORD_PATTERNS.get(word)
    if (!pattern) {
      pattern = new RegExp(`\\b${word}\\b`, 'g')
      STOP_WORD_PATTERNS.set(word, pattern)
    }
    pattern.lastIndex = 0
    score += lower.match(pattern)?.length ?? 0
  }
  return score
}

/**
 * Ngôn ngữ của một đoạn chữ do model viết. Hàm thuần, không I/O, không đổi chữ nào của model.
 */
export function answerLang(text: string | null | undefined): Lang {
  const raw = String(text ?? '')
  if (!raw.trim()) return 'en'

  const vietnameseScore = (raw.match(ACCENTED_LETTERS)?.length ?? 0) + stopWordScore(raw, VIETNAMESE_STOP_WORDS)
  const englishScore = stopWordScore(raw, ENGLISH_STOP_WORDS)

  return vietnameseScore >= ANSWER_LANG_MIN_SCORE && vietnameseScore > englishScore ? 'vi' : 'en'
}
