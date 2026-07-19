const normalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeValue(child)]),
    )
  }
  return value
}

export const normalizeSerializable = <Value>(value: Value): Value => {
  return normalizeValue(value) as Value
}

export const stableSerialize = (value: unknown): string => {
  return JSON.stringify(normalizeValue(value), null, 2)
}
