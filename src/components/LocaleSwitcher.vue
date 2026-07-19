<template>
  <Select
    class="locale-switcher"
    :value="locale"
    :options="localeOptions"
    :aria-label="t('locale.language')"
    @update:value="changeLocale"
  >
    <template #icon>
      <i-icon-park-outline:translate />
    </template>
  </Select>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LOCALES, setLocale, type SupportedLocale } from '@/i18n'
import Select from '@/components/Select.vue'

const { locale, t } = useI18n({ useScope: 'global' })

const localeOptions = computed(() => {
  return LOCALES.map(item => ({
    label: t(item.labelKey),
    value: item.code,
  }))
})

const changeLocale = (value: string | number) => {
  setLocale(value as SupportedLocale)
}
</script>

<style lang="scss" scoped>
.locale-switcher {
  width: 126px;
  margin-right: 4px;

  ::v-deep(.select) {
    height: 30px;
    border-color: transparent;
  }

  ::v-deep(.selector),
  ::v-deep(.icon) {
    height: 28px;
    line-height: 28px;
  }

  &:hover ::v-deep(.select) {
    background-color: #f1f1f1;
  }
}
</style>
