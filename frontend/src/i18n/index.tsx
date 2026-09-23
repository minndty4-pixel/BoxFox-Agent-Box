/**
 * Provider i18n. Chỉ export component để `eslint-plugin-react-refresh` yên tâm;
 * hook `useT` nằm ở `./context`.
 *
 * Mặc định tiếng Việt. Nếu thiếu khoá ở bản đang chọn thì rơi về tiếng Việt,
 * cuối cùng mới trả lại chính khoá — để lỗi thiếu chữ nhìn thấy được ngay chứ
 * không biến thành ô trống.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { DICTS } from './dicts'
import { I18nContext, labelFrom, type Lang, type TKey, type TVars } from './context'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en')

  const t = useCallback((key: TKey, vars?: TVars) => labelFrom(DICTS[lang], key, vars), [lang])

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
