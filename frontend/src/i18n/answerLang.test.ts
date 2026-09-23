/**
 * P5.1 — ca kiểm cho bộ nhận diện ngôn ngữ câu trả lời.
 *
 * Năm ca theo đúng nghiệm thu của plan: tiếng Việt CÓ DẤU, tiếng Việt KHÔNG DẤU, tiếng Anh, chuỗi
 * rỗng, và câu trộn hai thứ tiếng. Mặc định khi không rõ là `en` — chủ nhà chốt vậy.
 */
import { describe, expect, it } from 'vitest'
import { ANSWER_LANG_MIN_SCORE, answerLang } from './answerLang'

describe('answerLang — ngôn ngữ của chính câu trả lời (P5.1)', () => {
  it('tiếng Việt có dấu ⇒ `vi`', () => {
    expect(
      answerLang(
        'Em đã sửa nhãn ở bảng chạy và chụp lại ảnh tab sau khi đổi. Phần còn lại là chờ chủ nhà chốt.',
      ),
    ).toBe('vi')
  })

  it('tiếng Việt KHÔNG dấu (chủ nhà gõ không dấu) ⇒ vẫn `vi` nhờ từ dừng', () => {
    expect(
      answerLang(
        'Em da sua xong nhan roi, viec nay cho chu nha quyet, va con mot phan nhu cu.',
      ),
    ).toBe('vi')
  })

  it('tiếng Việt gõ không dấu mà không đủ từ dừng ⇒ về `en` (mặc định an toàn)', () => {
    expect(answerLang('Em da sua nhan o bang chay va chup lai anh tab sau khi doi.')).toBe('en')
  })

  it('tiếng Anh ⇒ `en`', () => {
    expect(
      answerLang(
        'I changed the label in the runs table and captured the tab after the change. What is left is your call.',
      ),
    ).toBe('en')
  })

  it('chuỗi rỗng / chỉ khoảng trắng ⇒ `en` (mặc định an toàn)', () => {
    expect(answerLang('')).toBe('en')
    expect(answerLang('   \n  ')).toBe('en')
    expect(answerLang(null)).toBe('en')
    expect(answerLang(undefined)).toBe('en')
  })

  it('câu trộn hai thứ tiếng: bên nào nhiều điểm hơn thì thắng', () => {
    // Tiếng Anh là thân câu, chỉ có một từ tiếng Việt không dấu → dưới ngưỡng ⇒ `en`.
    expect(
      answerLang('The pipeline is fixed and the runs table now shows the new label, per ban sua nay.'),
    ).toBe('en')
    // Tiếng Việt là thân câu, tiếng Anh chỉ còn vài danh từ kỹ thuật ⇒ `vi`.
    expect(
      answerLang('Em đã sửa pipeline rồi, bảng runs hiện nhãn mới; phần còn lại chờ chủ nhà quyết.'),
    ).toBe('vi')
  })

  it('toàn code / đường dẫn ⇒ `en` (không có tín hiệu tiếng Việt nào)', () => {
    expect(answerLang('npm run build && pytest backend/tests/unit -q')).toBe('en')
    expect(answerLang('.generated_artifacts/captures/tab/2e4f1a20/2e4f1a20_007_tab-runs.png')).toBe('en')
  })

  it('một hai ký tự tiếng Việt lẻ trong câu tiếng Anh chưa đủ để thành `vi`', () => {
    const text = 'The fix is in place, thanks. See the file đường-dẫn.png for the capture.'
    expect(answerLang(text)).toBe('en')
  })

  it('ngưỡng là hằng số công khai, có thể đối chiếu', () => {
    expect(ANSWER_LANG_MIN_SCORE).toBe(3)
    // Đúng ngưỡng mà vượt điểm tiếng Anh ⇒ `vi`…
    const atThreshold = 'Em sửa rồi, còn việc chờ chủ nhà.'
    expect(answerLang(atThreshold)).toBe('vi')
    // …còn dưới ngưỡng thì không.
    const below = 'Em fixed the build, thanks.'
    expect(answerLang(below)).toBe('en')
  })

  it('câu tiếng Anh TRÍCH chuỗi giao diện tiếng Việt trong span mã ⇒ `en` (chữ trong mã là dữ liệu)', () => {
    expect(
      answerLang(
        'I renamed the tile label to `Ảnh chụp tab` and the receipt now reads `Suy luận · 1 lệnh`, so the ' +
          'answer face is fully in English with the new wording.',
      ),
    ).toBe('en')
  })

  it('câu tiếng Anh có chú thích tiếng Việt trong khối mã ⇒ `en`', () => {
    expect(
      answerLang(
        [
          'The regression is gone. The fixture that proves it:',
          '',
          '```python',
          '# lượt 1: đã kiểm chứng — một mảnh bằng chứng tiếng Việt',
          'assert verdict == "sufficient"  # câu trả lời của chủ nhà',
          '```',
          '',
          'That is the whole change, and the suite is green.',
        ].join('\n'),
      ),
    ).toBe('en')
  })

  it('câu trả lời tiếng VIỆT có chuỗi tiếng Việt trong mã ⇒ vẫn `vi` (chữ ngoài mã quyết định)', () => {
    expect(
      answerLang(
        [
          'Em đã đổi nhãn ở bảng chạy và chụp lại ảnh tab sau khi sửa, phần còn lại chờ chủ nhà quyết.',
          '',
          '```ts',
          "const key = 'chat.mediaCaption.capture-tab'",
          '```',
        ].join('\n'),
      ),
    ).toBe('vi')
  })

  it('toàn bộ chữ nằm trong mã ⇒ `en` (không còn tín hiệu nào ngoài mã)', () => {
    expect(answerLang('```\nẢnh chụp cửa sổ, Ảnh chụp tab\n```')).toBe('en')
    // Khối mã chưa đóng (đang stream) cũng không được tính điểm.
    expect(answerLang('Đang viết:\n```python\n# câu trả lời tiếng Việt chưa có chữ nào ngoài mã')).toBe('en')
  })
})
