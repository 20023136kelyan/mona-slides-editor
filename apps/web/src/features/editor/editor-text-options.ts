export const editorFontOptions = [
  { label: '思源黑体', value: 'SourceHanSans' },
  { label: '思源宋体', value: 'SourceHanSerif' },
  { label: '文鼎PL楷体', value: 'WenDingPLKaiTi' },
  { label: '文鼎PL宋体', value: 'WenDingPLSongTi' },
  { label: '朱雀仿宋', value: 'ZhuQueFangSong' },
  { label: '霞鹜文楷', value: 'LXGWWenKai' },
  { label: '霞鹜新致宋', value: 'LXGWNeoZhiSong' },
  { label: '霞鹜新晰黑', value: 'LXGWNeoXiHei' },
  { label: '阿里巴巴普惠体', value: 'AlibabaPuHuiTi' },
  { label: '得意黑', value: 'DeYiHei' },
  { label: 'MiSans', value: 'MiSans' },
  { label: 'Source Serif 4', value: 'SourceSerif4' },
  { label: 'JetBrains Mono', value: 'JetBrainsMono' },
  { label: 'Literata', value: 'Literata' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Roboto', value: 'Roboto' },
  { label: 'Open Sans', value: 'OpenSans' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Source Sans Pro', value: 'SourceSansPro' },
  { label: 'Merriweather', value: 'Merriweather' },
  { label: 'Lato', value: 'Lato' },
] as const

export const editorFontSizeOptions = [
  '12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px',
  '36px', '40px', '44px', '48px', '54px', '60px', '66px', '72px', '76px',
  '80px', '88px', '96px', '104px', '112px', '120px',
].map(value => ({ label: value, value }))

export const editorLineHeightOptions = [0.9, 1, 1.15, 1.2, 1.4, 1.5, 1.8, 2, 2.5, 3]
  .map(value => ({ label: `${value}×`, value }))

export const editorParagraphSpaceOptions = [0, 5, 10, 15, 20, 25, 30, 40, 50, 80]
  .map(value => ({ label: `${value}px`, value }))

export const editorWordSpaceOptions = [0, 1, 2, 3, 4, 5, 6, 8, 10]
  .map(value => ({ label: `${value}px`, value }))
