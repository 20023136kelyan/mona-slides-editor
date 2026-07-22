import type { SlideTemplate } from './model'

export const DEFAULT_TEMPLATE_CATALOG: readonly SlideTemplate[] = [
  { name: 'Crimson Landscape', id: 'template_1', cover: './imgs/template_1.webp', origin: 'Official' },
  { name: 'Urban Blue', id: 'template_2', cover: './imgs/template_2.webp', origin: 'Official' },
  { name: 'Smart Geometry', id: 'template_3', cover: './imgs/template_3.webp', origin: 'Official' },
  { name: 'Soft Morandi', id: 'template_4', cover: './imgs/template_4.webp', origin: 'Official' },
  { name: 'Minimal Green', id: 'template_5', cover: './imgs/template_5.webp', origin: 'Community contribution, refined by the official team' },
  { name: 'Warm Vintage', id: 'template_6', cover: './imgs/template_6.webp', origin: 'Community contribution, refined by the official team' },
  { name: 'Deep Focus', id: 'template_7', cover: './imgs/template_7.webp', origin: 'Community contribution, refined by the official team' },
  { name: 'Fresh Sky Blue', id: 'template_8', cover: './imgs/template_8.webp', origin: 'Community contribution, refined by the official team' },
] as const
