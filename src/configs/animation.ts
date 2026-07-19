import type { TurningMode } from '@/types/slides'

export const ANIMATION_DEFAULT_DURATION = 1000
export const ANIMATION_DEFAULT_TRIGGER = 'click'
export const ANIMATION_CLASS_PREFIX = 'animate__'

export const ENTER_ANIMATIONS = [
  {
    type: 'bounce',
    children: [
      { value: 'bounceIn' },
      { value: 'bounceInLeft' },
      { value: 'bounceInRight' },
      { value: 'bounceInUp' },
      { value: 'bounceInDown' },
    ],
  },
  {
    type: 'fade',
    children: [
      { value: 'fadeIn' },
      { value: 'fadeInDown' },
      { value: 'fadeInDownBig' },
      { value: 'fadeInLeft' },
      { value: 'fadeInLeftBig' },
      { value: 'fadeInRight' },
      { value: 'fadeInRightBig' },
      { value: 'fadeInUp' },
      { value: 'fadeInUpBig' },
      { value: 'fadeInTopLeft' },
      { value: 'fadeInTopRight' },
      { value: 'fadeInBottomLeft' },
      { value: 'fadeInBottomRight' },
    ],
  },
  {
    type: 'rotate',
    children: [
      { value: 'rotateIn' },
      { value: 'rotateInDownLeft' },
      { value: 'rotateInDownRight' },
      { value: 'rotateInUpLeft' },
      { value: 'rotateInUpRight' },
    ],
  },
  {
    type: 'zoom',
    children: [
      { value: 'zoomIn' },
      { value: 'zoomInDown' },
      { value: 'zoomInLeft' },
      { value: 'zoomInRight' },
      { value: 'zoomInUp' },
    ],
  },
  {
    type: 'slide',
    children: [
      { value: 'slideInDown' },
      { value: 'slideInLeft' },
      { value: 'slideInRight' },
      { value: 'slideInUp' },
    ],
  },
  {
    type: 'flip',
    children: [
      { value: 'flipInX' },
      { value: 'flipInY' },
    ],
  },
  {
    type: 'back',
    children: [
      { value: 'backInDown' },
      { value: 'backInLeft' },
      { value: 'backInRight' },
      { value: 'backInUp' },
    ],
  },
  {
    type: 'lightSpeed',
    children: [
      { value: 'lightSpeedInRight' },
      { value: 'lightSpeedInLeft' },
    ],
  },
]

export const EXIT_ANIMATIONS = [
  {
    type: 'bounce',
    children: [
      { value: 'bounceOut' },
      { value: 'bounceOutLeft' },
      { value: 'bounceOutRight' },
      { value: 'bounceOutUp' },
      { value: 'bounceOutDown' },
    ],
  },
  {
    type: 'fade',
    children: [
      { value: 'fadeOut' },
      { value: 'fadeOutDown' },
      { value: 'fadeOutDownBig' },
      { value: 'fadeOutLeft' },
      { value: 'fadeOutLeftBig' },
      { value: 'fadeOutRight' },
      { value: 'fadeOutRightBig' },
      { value: 'fadeOutUp' },
      { value: 'fadeOutUpBig' },
      { value: 'fadeOutTopLeft' },
      { value: 'fadeOutTopRight' },
      { value: 'fadeOutBottomLeft' },
      { value: 'fadeOutBottomRight' },
    ],
  },
  {
    type: 'rotate',
    children: [
      { value: 'rotateOut' },
      { value: 'rotateOutDownLeft' },
      { value: 'rotateOutDownRight' },
      { value: 'rotateOutUpLeft' },
      { value: 'rotateOutUpRight' },
    ],
  },
  {
    type: 'zoom',
    children: [
      { value: 'zoomOut' },
      { value: 'zoomOutDown' },
      { value: 'zoomOutLeft' },
      { value: 'zoomOutRight' },
      { value: 'zoomOutUp' },
    ],
  },
  {
    type: 'slide',
    children: [
      { value: 'slideOutDown' },
      { value: 'slideOutLeft' },
      { value: 'slideOutRight' },
      { value: 'slideOutUp' },
    ],
  },
  {
    type: 'flip',
    children: [
      { value: 'flipOutX' },
      { value: 'flipOutY' },
    ],
  },
  {
    type: 'back',
    children: [
      { value: 'backOutDown' },
      { value: 'backOutLeft' },
      { value: 'backOutRight' },
      { value: 'backOutUp' },
    ],
  },
  {
    type: 'lightSpeed',
    children: [
      { value: 'lightSpeedOutRight' },
      { value: 'lightSpeedOutLeft' },
    ],
  },
]

export const ATTENTION_ANIMATIONS = [
  {
    type: 'shake',
    children: [
      { value: 'shakeX' },
      { value: 'shakeY' },
      { value: 'headShake' },
      { value: 'swing' },
      { value: 'wobble' },
      { value: 'tada' },
      { value: 'jello' },
    ],
  },
  {
    type: 'other',
    children: [
      { value: 'bounce' },
      { value: 'flash' },
      { value: 'pulse' },
      { value: 'rubberBand' },
      { value: 'heartBeat' },
    ],
  },
]

interface SlideAnimation {
  value: TurningMode
}

export const SLIDE_ANIMATIONS: SlideAnimation[] = [
  { value: 'no' },
  { value: 'random' },
  { value: 'slideX' },
  { value: 'slideY' },
  { value: 'slideX3D' },
  { value: 'slideY3D' },
  { value: 'fade' },
  { value: 'rotate' },
  { value: 'scaleY' },
  { value: 'scaleX' },
  { value: 'scale' },
  { value: 'scaleReverse' },
]
