<template>
  <div class="multi-position-panel">
    <ButtonGroup class="row">
      <Button style="flex: 1;" v-tooltip="$t('common.leftAlign')" @click="alignElement(ElementAlignCommands.LEFT)"><i-icon-park-outline:align-left /></Button>
      <Button style="flex: 1;" v-tooltip="$t('common.horizontalCenter')" @click="alignElement(ElementAlignCommands.HORIZONTAL)"><i-icon-park-outline:align-horizontally /></Button>
      <Button style="flex: 1;" v-tooltip="$t('common.rightAlign')" @click="alignElement(ElementAlignCommands.RIGHT)"><i-icon-park-outline:align-right /></Button>
    </ButtonGroup>
    <ButtonGroup class="row">
      <Button style="flex: 1;" v-tooltip="$t('common.topAlign')" @click="alignElement(ElementAlignCommands.TOP)"><i-icon-park-outline:align-top /></Button>
      <Button style="flex: 1;" v-tooltip="$t('common.verticalCenter')" @click="alignElement(ElementAlignCommands.VERTICAL)"><i-icon-park-outline:align-vertically /></Button>
      <Button style="flex: 1;" v-tooltip="$t('common.bottomAlign')" @click="alignElement(ElementAlignCommands.BOTTOM)"><i-icon-park-outline:align-bottom /></Button>
    </ButtonGroup>
    <ButtonGroup class="row" v-if="displayItemCount > 2">
      <Button style="flex: 1;" @click="uniformHorizontalDisplay()">{{ $t('toolbar.distributeHorizontally') }}</Button>
      <Button style="flex: 1;" @click="uniformVerticalDisplay()">{{ $t('toolbar.distributeVertically') }}</Button>
    </ButtonGroup>

    <Divider />

    <ButtonGroup class="row">
      <Button :disabled="!canCombine" @click="combineElements()" style="flex: 1;"><i-icon-park-outline:group style="margin-right: 3px;" />{{ $t('common.group') }}</Button>
      <Button :disabled="canCombine" @click="uncombineElements()" style="flex: 1;"><i-icon-park-outline:ungroup style="margin-right: 3px;" />{{ $t('common.ungroup') }}</Button>
    </ButtonGroup>
  </div>
</template>

<script lang="ts" setup>
import { ElementAlignCommands } from '@/types/edit'
import useCombineElement from '@/hooks/useCombineElement'
import useAlignActiveElement from '@/hooks/useAlignActiveElement'
import useAlignElementToCanvas from '@/hooks/useAlignElementToCanvas'
import useUniformDisplayElement from '@/hooks/useUniformDisplayElement'
import Divider from '@/components/Divider.vue'
import Button from '@/components/Button.vue'
import ButtonGroup from '@/components/ButtonGroup.vue'

const { canCombine, combineElements, uncombineElements } = useCombineElement()
const { alignActiveElement } = useAlignActiveElement()
const { alignElementToCanvas } = useAlignElementToCanvas()
const { displayItemCount, uniformHorizontalDisplay, uniformVerticalDisplay } = useUniformDisplayElement()

// 多选元素对齐，需要先判断当前所选中的元素状态：
// 如果所选元素为一组组合元素，则将它对齐到画布；
// 如果所选元素不是组合元素或不止一组元素（即当前为可组合状态），则将这多个（多组）元素相互对齐。
const alignElement = (command: ElementAlignCommands) => {
  if (canCombine.value) alignActiveElement(command)
  else alignElementToCanvas(command)
}
</script>

<style lang="scss" scoped>
.row {
  width: 100%;
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
</style>
