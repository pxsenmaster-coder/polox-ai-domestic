export type AppLocale = 'zh-CN' | 'en-US'

const LOCALE_KEY = 'polox-app-locale'

export function useAppLocale() {
  const locale = useState<AppLocale>('polox-app-locale', () => 'zh-CN')
  const restored = useState('polox-app-locale-restored', () => false)
  const isChinese = computed(() => locale.value === 'zh-CN')

  function restoreLocale() {
    if (!import.meta.client || restored.value)
      return
    restored.value = true
    try {
      const saved = localStorage.getItem(LOCALE_KEY)
      if (saved === 'zh-CN' || saved === 'en-US')
        locale.value = saved
    }
    catch { /* Keep the in-memory language when browser storage is unavailable. */ }
  }

  function setLocale(value: AppLocale) {
    locale.value = value
    if (!import.meta.client)
      return
    try { localStorage.setItem(LOCALE_KEY, value) }
    catch { /* The language still changes for this session. */ }
  }

  function toggleLocale() {
    setLocale(isChinese.value ? 'en-US' : 'zh-CN')
  }

  function t(english: string, chinese: string) {
    return isChinese.value ? chinese : english
  }

  return { locale, isChinese, restoreLocale, setLocale, toggleLocale, t }
}
