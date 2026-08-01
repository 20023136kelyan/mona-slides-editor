// The rail drops to icons automatically below the snug breakpoint and manually
// through the shared header control. All surfaces import the same transitions
// so route-specific menu content cannot drift from the application shell.
export const applicationSidebarIconRow = 'mona-rail-shift transition-[padding] duration-200 ease-out max-snug:ps-(--mona-rail-icon-inset) max-snug:pe-0 group-data-[collapsed=true]/rail:ps-(--mona-rail-icon-inset) group-data-[collapsed=true]/rail:pe-0'
export const applicationSidebarIconRowInner = 'max-snug:flex-none group-data-[collapsed=true]/rail:flex-none'
export const applicationSidebarIconLabel = 'mona-rail-shift ms-3 max-w-56 transition-[max-width,margin,opacity] duration-200 ease-out max-snug:ms-0 max-snug:max-w-0 max-snug:opacity-0 group-data-[collapsed=true]/rail:ms-0 group-data-[collapsed=true]/rail:max-w-0 group-data-[collapsed=true]/rail:opacity-0'
export const applicationSidebarIconHidden = 'mona-rail-shift transition-[width,opacity,transform] duration-200 ease-out max-snug:w-0 max-snug:opacity-0 group-data-[collapsed=true]/rail:w-0 group-data-[collapsed=true]/rail:opacity-0'
// SidebarGroupAction is centered 1.375rem from the rail edge. A menu row sits
// inside the group's 0.5rem gutter, so this end padding puts an inline trailing
// control on that same action-column centerline.
export const applicationSidebarTrailingControlRow = 'pe-1.5'
export const applicationSidebarIconSize = (macChrome: boolean) => (
  macChrome ? 'size-4 group-data-[collapsed=true]/rail:size-5 max-snug:size-5' : 'size-4'
)
