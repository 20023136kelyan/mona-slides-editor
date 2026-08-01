import { analyzePowerPointWriteback } from './analyze'
import { patchPowerPointPackage } from './patch-package'
import type {
  PowerPointWritebackInput,
  PowerPointWritebackResult,
} from './types'
import { PowerPointWritebackError } from './types'

export * from './analyze'
export * from './patch-package'
export * from './types'

export const writeBackPowerPoint = async (
  input: PowerPointWritebackInput,
): Promise<PowerPointWritebackResult> => {
  const packageId = input.manifest.packageId
  const plan = analyzePowerPointWriteback(
    input.baseline,
    input.presentation,
    packageId,
  )
  if (plan.unsupported.length) throw new PowerPointWritebackError(plan.unsupported)
  return {
    bytes: await patchPowerPointPackage({
    bytes: input.bytes,
    manifest: input.manifest,
    operations: plan.operations,
    resolveAsset: input.resolveAsset,
  }),
    plan,
  }
}
