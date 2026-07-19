<template>
  <div class="export-img-dialog">
    <div class="thumbnails-view">
      <div class="thumbnails" ref="imageThumbnailsRef">
        <ThumbnailSlide 
          class="thumbnail" 
          v-for="slide in renderSlides" 
          :key="slide.id" 
          :slide="slide" 
          :size="1600" 
        />
      </div>
    </div>
    <div class="configs">
      <div class="row">
        <div class="title">{{ $t('export.format') }}</div>
        <RadioGroup
          class="config-item"
          v-model:value="format"
        >
          <RadioButton style="width: 50%;" value="jpeg">JPEG</RadioButton>
          <RadioButton style="width: 50%;" value="png">PNG</RadioButton>
        </RadioGroup>
      </div>
      <div class="row">
        <div class="title">{{ $t('export.range') }}</div>
        <RadioGroup
          class="config-item"
          v-model:value="rangeType"
        >
          <RadioButton style="width: 33.33%;" value="all">{{ $t('common.all') }}</RadioButton>
          <RadioButton style="width: 33.33%;" value="current">{{ $t('common.currentSlide') }}</RadioButton>
          <RadioButton style="width: 33.33%;" value="custom">{{ $t('common.custom') }}</RadioButton>
        </RadioGroup>
      </div>
      <div class="row" style="margin-bottom: 32px" v-if="rangeType === 'custom'">
        <div class="title" :data-range="`(${range[0]}–${range[1]})`">{{ $t('common.customRange') }}:</div>
        <Slider
          class="config-item"
          range
          :min="1"
          :max="slides.length"
          :step="1"
          v-model:value="range"
        />
      </div>

      <div class="row">
        <div class="title">{{ $t('export.imageQuality') }}</div>
        <Slider
          class="config-item"
          :min="0"
          :max="1"
          :step="0.1"
          v-model:value="quality"
        />
      </div>

      <div class="row">
        <div class="title">{{ $t('export.ignoreWebFonts') }}</div>
        <div class="config-item">
          <Switch v-model:value="ignoreWebfont" v-tooltip="$t('export.ignoreWebFontsHelp')" />
        </div>
      </div>
    </div>

    <div class="btns">
      <Button class="btn export" type="primary" @click="expImage()"><i-icon-park-outline:download /> {{ $t('export.exportImage') }}</Button>
      <Button class="btn close" @click="emit('close')">{{ $t('common.close') }}</Button>
    </div>

    <FullscreenSpin :loading="exporting" :tip="$t('common.exporting')" />
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useSlidesStore } from '@/store'
import useExport from '@/hooks/useExport'

import ThumbnailSlide from '@/views/components/ThumbnailSlide/index.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'
import Switch from '@/components/Switch.vue'
import Slider from '@/components/Slider.vue'
import Button from '@/components/Button.vue'
import RadioButton from '@/components/RadioButton.vue'
import RadioGroup from '@/components/RadioGroup.vue'

const emit = defineEmits<{
  (event: 'close'): void
}>()

const { slides, currentSlide } = storeToRefs(useSlidesStore())

const imageThumbnailsRef = useTemplateRef<HTMLElement>('imageThumbnailsRef')
const rangeType = ref<'all' | 'current' | 'custom'>('all')
const range = ref<[number, number]>([1, slides.value.length])
const format = ref<'jpeg' | 'png'>('jpeg')
const quality = ref(1)
const ignoreWebfont = ref(false)

const renderSlides = computed(() => {
  if (rangeType.value === 'all') return slides.value
  if (rangeType.value === 'current') return [currentSlide.value]
  return slides.value.filter((item, index) => {
    const [min, max] = range.value
    return index >= min - 1 && index <= max - 1
  })
})

const { exportImage, exporting } = useExport()

const expImage = () => {
  if (!imageThumbnailsRef.value) return
  exportImage(imageThumbnailsRef.value, format.value, quality.value, ignoreWebfont.value)
}
</script>

<style lang="scss" scoped>
.export-img-dialog {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.thumbnails-view {
  @include absolute-0();

  &::after {
    content: '';
    background-color: #fff;
    @include absolute-0();
  }
}
.configs {
  width: 350px;
  height: calc(100% - 80px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  z-index: 1;

  .row {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 25px;
  }

  .title {
    width: 100px;
    position: relative;

    &::after {
      content: attr(data-range);
      position: absolute;
      top: 20px;
      left: 0;
    }
  }
  .config-item {
    flex: 1;
  }
}
.btns {
  width: 300px;
  height: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1;

  .export {
    flex: 1;
  }
  .close {
    width: 100px;
    margin-left: 10px;
  }
}
</style>
