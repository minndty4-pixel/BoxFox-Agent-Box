/**
 * Bảng từ điển của hai ngôn ngữ, tách khỏi `index.tsx` (chỗ chứa component provider) để file đó
 * chỉ export một loại thứ — quy tắc của `eslint-plugin-react-refresh`.
 *
 * P5.3: chỗ app viết chữ quanh một lượt phải tra được từ điển theo **ngôn ngữ câu trả lời**, không
 * chỉ theo ngôn ngữ giao diện, nên bảng này là thứ hai đường cùng đọc.
 */
import vi from './vi'
import en from './en'
import type { Lang } from './context'

export const DICTS: Record<Lang, unknown> = { vi, en }
