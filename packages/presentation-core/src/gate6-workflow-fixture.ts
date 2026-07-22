import type { PPTTextElement, Slide } from './model'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const text = (id: string, content: string, top: number): PPTTextElement => ({
  type: 'text',
  id,
  left: 90,
  top,
  width: 820,
  height: 80,
  content: `<p>${content}</p>`,
  rotate: 0,
  defaultFontName: 'Arial',
  defaultColor: '#17324d',
  fixedHeight: true,
})

const gate6WorkflowSlides: readonly Slide[] = [
  {
    id: 'gate6-section-alpha',
    sectionTag: { id: 'gate6-alpha', title: 'Planning' },
    type: 'cover',
    notes: [
      {
        id: 'gate6-note-1',
        content: 'Check the opening claim.',
        time: 1_700_000_000_000,
        user: 'Mona',
        elId: 'gate6-alpha-title',
        replies: [{ id: 'gate6-reply-1', content: 'The claim is sourced.', time: 1_700_000_050_000, user: 'Reviewer' }],
      },
      { id: 'gate6-note-2', content: 'Confirm the date.', time: 1_700_000_100_000, user: 'Mona' },
    ],
    remark: 'Opening speaker remark',
    background: { type: 'solid', color: '#f8f3ed' },
    elements: [text('gate6-alpha-title', 'Gate 6 planning', 170)],
  },
  {
    id: 'gate6-alpha-agenda',
    type: 'contents',
    background: { type: 'solid', color: '#eef5f8' },
    elements: [text('gate6-alpha-agenda-title', 'Agenda', 120)],
  },
  {
    id: 'gate6-section-beta',
    sectionTag: { id: 'gate6-beta' },
    type: 'transition',
    background: { type: 'solid', color: '#f2edf7' },
    elements: [text('gate6-beta-title', 'Execution', 180)],
  },
  {
    id: 'gate6-beta-content',
    type: 'content',
    turningMode: 'fade',
    notes: [{ id: 'gate6-note-3', content: 'Ask for questions.', time: 1_700_000_200_000, user: 'Mona' }],
    remark: 'Pause before the chart.',
    background: { type: 'solid', color: '#edf7f0' },
    elements: [
      {
        ...text('gate6-beta-content-title', 'Signal signal SIGNAL', 35),
        content: '<p><span>Signal </span><strong>signal</strong> SIGNAL</p>',
        name: 'Search headline',
        textType: 'title',
      },
      {
        id: 'gate6-group-shape',
        groupId: 'gate6-selection-group',
        type: 'shape',
        left: 90,
        top: 155,
        width: 210,
        height: 130,
        rotate: 0,
        fixedRatio: false,
        viewBox: [210, 130],
        path: 'M 0 0 L 210 0 L 210 130 L 0 130 Z',
        fill: '#b7dce8',
        name: 'Grouped shape',
        text: {
          content: '<p>Signal shape</p>',
          defaultFontName: 'Arial',
          defaultColor: '#17324d',
          align: 'middle',
          type: 'itemTitle',
        },
      },
      {
        ...text('gate6-group-text', 'Grouped text', 185),
        groupId: 'gate6-selection-group',
        left: 110,
        width: 170,
        name: 'Grouped text',
      },
      {
        id: 'gate6-locked-image',
        type: 'image',
        left: 345,
        top: 155,
        width: 180,
        height: 130,
        rotate: 0,
        fixedRatio: false,
        lock: true,
        name: 'Locked image',
        imageType: 'itemFigure',
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='130'%3E%3Crect width='180' height='130' fill='%23f2dbdb'/%3E%3Ccircle cx='90' cy='65' r='38' fill='%23d14424'/%3E%3C/svg%3E",
      },
      {
        id: 'gate6-search-table',
        type: 'table',
        left: 570,
        top: 145,
        width: 330,
        height: 160,
        rotate: 0,
        colWidths: [0.5, 0.5],
        cellMinHeight: 55,
        outline: { width: 2, color: '#525252', style: 'solid' },
        data: [
          [
            { id: 'gate6-cell-a', colspan: 1, rowspan: 1, text: '<p>Signal table</p>', style: { color: '#17324d', fontsize: '16px' } },
            { id: 'gate6-cell-b', colspan: 1, rowspan: 1, text: '<p>control</p>', style: { color: '#17324d', fontsize: '16px' } },
          ],
          [
            { id: 'gate6-cell-c', colspan: 1, rowspan: 1, text: '<p>signal table</p>', style: { color: '#17324d', fontsize: '16px' } },
            { id: 'gate6-cell-d', colspan: 1, rowspan: 1, text: '<p>finish</p>', style: { color: '#17324d', fontsize: '16px' } },
          ],
        ],
      },
    ],
  },
  {
    id: 'gate6-beta-end',
    type: 'end',
    background: { type: 'solid', color: '#f7eeee' },
    elements: [text('gate6-beta-end-title', 'Thank you', 190)],
  },
]

export const appendGate6WorkflowFixture = (slides: readonly Slide[]): Slide[] => {
  if (slides.some(slide => slide.id === gate6WorkflowSlides[0]!.id)) return clone([...slides])
  return [...clone(slides), ...clone(gate6WorkflowSlides)]
}
