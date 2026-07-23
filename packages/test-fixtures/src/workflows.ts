import type { PPTTextElement, Slide } from '@mona/presentation-core/model'

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

const workflowSlides: readonly Slide[] = [
  {
    id: 'workflow-section-alpha',
    sectionTag: { id: 'workflow-alpha', title: 'Planning' },
    type: 'cover',
    notes: [
      {
        id: 'workflow-note-1',
        content: 'Check the opening claim.',
        time: 1_700_000_000_000,
        user: 'Mona',
        elId: 'workflow-alpha-title',
        replies: [{ id: 'workflow-reply-1', content: 'The claim is sourced.', time: 1_700_000_050_000, user: 'Reviewer' }],
      },
      { id: 'workflow-note-2', content: 'Confirm the date.', time: 1_700_000_100_000, user: 'Mona' },
    ],
    remark: 'Opening speaker remark',
    background: { type: 'solid', color: '#f8f3ed' },
    elements: [text('workflow-alpha-title', 'Workflow planning', 170)],
  },
  {
    id: 'workflow-alpha-agenda',
    type: 'contents',
    background: { type: 'solid', color: '#eef5f8' },
    elements: [text('workflow-alpha-agenda-title', 'Agenda', 120)],
  },
  {
    id: 'workflow-section-beta',
    sectionTag: { id: 'workflow-beta' },
    type: 'transition',
    background: { type: 'solid', color: '#f2edf7' },
    elements: [text('workflow-beta-title', 'Execution', 180)],
  },
  {
    id: 'workflow-beta-content',
    type: 'content',
    turningMode: 'fade',
    notes: [{ id: 'workflow-note-3', content: 'Ask for questions.', time: 1_700_000_200_000, user: 'Mona' }],
    remark: 'Pause before the chart.',
    background: { type: 'solid', color: '#edf7f0' },
    elements: [
      {
        ...text('workflow-beta-content-title', 'Signal signal SIGNAL', 35),
        content: '<p><span>Signal </span><strong>signal</strong> SIGNAL</p>',
        name: 'Search headline',
        textType: 'title',
      },
      {
        id: 'workflow-group-shape',
        groupId: 'workflow-selection-group',
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
        ...text('workflow-group-text', 'Grouped text', 185),
        groupId: 'workflow-selection-group',
        left: 110,
        width: 170,
        name: 'Grouped text',
      },
      {
        id: 'workflow-locked-image',
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
        id: 'workflow-search-table',
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
            { id: 'workflow-cell-a', colspan: 1, rowspan: 1, text: '<p>Signal table</p>', style: { color: '#17324d', fontsize: '16px' } },
            { id: 'workflow-cell-b', colspan: 1, rowspan: 1, text: '<p>control</p>', style: { color: '#17324d', fontsize: '16px' } },
          ],
          [
            { id: 'workflow-cell-c', colspan: 1, rowspan: 1, text: '<p>signal table</p>', style: { color: '#17324d', fontsize: '16px' } },
            { id: 'workflow-cell-d', colspan: 1, rowspan: 1, text: '<p>finish</p>', style: { color: '#17324d', fontsize: '16px' } },
          ],
        ],
      },
    ],
  },
  {
    id: 'workflow-beta-end',
    type: 'end',
    background: { type: 'solid', color: '#f7eeee' },
    elements: [text('workflow-beta-end-title', 'Thank you', 190)],
  },
]

export const appendWorkflowFixture = (slides: readonly Slide[]): Slide[] => {
  if (slides.some(slide => slide.id === workflowSlides[0]!.id)) return clone([...slides])
  return [...clone(slides), ...clone(workflowSlides)]
}
