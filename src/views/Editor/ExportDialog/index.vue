<template>
  <div class="export-dialog">
    <Tabs 
      :tabs="tabs" 
      :value="dialogForExport" 
      card
      @update:value="key => setDialogForExport(key as DialogForExportTypes)" 
    />
    <div class="content">
      <component :is="currentDialogComponent" @close="setDialogForExport('')"></component>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useMainStore } from '@/store'
import type { DialogForExportTypes } from '@/types/export'

import ExportImage from './ExportImage.vue'
import ExportJSON from './ExportJSON.vue'
import ExportPDF from './ExportPDF.vue'
import ExportPPTX from './ExportPPTX.vue'
import ExportSpecificFile from './ExportSpecificFile.vue'
import Tabs from '@/components/Tabs.vue'

interface TabItem {
  key: DialogForExportTypes
  label: string
}

const mainStore = useMainStore()
const { dialogForExport } = storeToRefs(mainStore)

const setDialogForExport = mainStore.setDialogForExport
const { t } = useI18n()

const tabs = computed<TabItem[]>(() => [
  { key: 'pptist', label: t('export.exportPptist') },
  { key: 'pptx', label: t('export.exportPptx') },
  { key: 'image', label: t('export.exportImage') },
  { key: 'json', label: t('export.exportJson') },
  { key: 'pdf', label: t('export.exportPdf') },
])

const currentDialogComponent = computed<unknown>(() => {
  const dialogMap = {
    'image': ExportImage,
    'json': ExportJSON,
    'pdf': ExportPDF,
    'pptx': ExportPPTX,
    'pptist': ExportSpecificFile,
  }
  if (dialogForExport.value) return dialogMap[dialogForExport.value] || null
  return null
})
</script>

<style lang="scss" scoped>
.export-dialog {
  margin: -20px;
}
.content {
  height: 460px;
  padding: 12px;
  font-size: 13px;

  @include overflow-overlay();
}
</style>
