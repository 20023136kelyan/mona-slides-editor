import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FONTS } from '@/configs/font'

export default function useLocalizedFonts() {
  const { t } = useI18n()

  return computed(() => FONTS.map(font => font.value
    ? font
    : { ...font, label: t('common.defaultFont') }
  ))
}
