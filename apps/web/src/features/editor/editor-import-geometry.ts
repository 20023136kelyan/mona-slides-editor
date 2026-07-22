export const getImportedAspectRatio = (width: number, height: number) => {
  if (!width || !height) return 0.5625
  const ratio = height / width
  for (const standard of [0.625, 0.75, 0.5625]) {
    if (Math.abs(ratio - standard) < 1e-10) return standard
  }
  return ratio
}
