import JSZip from 'jszip'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { PowerPointPackageBackingStore } from '@/features/editor/editor-pptx-backing-store'
import { createPowerPointPackageBacking } from '@/features/editor/editor-pptx-package'
import { clearPowerPointPackages } from '@/lib/deck-storage'

const relationshipType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const fixture = async (): Promise<ArrayBuffer> => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
    </Types>`)
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>')
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="${relationshipType}">
    <Relationship Id="rId1" Type="${relationshipType}/slide" Target="slides/slide1.xml"/>
  </Relationships>`)
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld></p:sld>')
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<Relationships xmlns="${relationshipType}">
    <Relationship Id="rId1" Type="${relationshipType}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  </Relationships>`)
  zip.file('ppt/slideLayouts/slideLayout1.xml', '<p:sldLayout xmlns:p="p"/>')
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<Relationships xmlns="${relationshipType}">
    <Relationship Id="rId1" Type="${relationshipType}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
  </Relationships>`)
  zip.file('ppt/slideMasters/slideMaster1.xml', '<p:sldMaster xmlns:p="p"/>')
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<Relationships xmlns="${relationshipType}">
    <Relationship Id="rId1" Type="${relationshipType}/theme" Target="../theme/theme1.xml"/>
  </Relationships>`)
  zip.file('ppt/theme/theme1.xml', '<a:theme xmlns:a="a"/>')
  return zip.generateAsync({ type: 'arraybuffer' })
}

beforeEach(async () => {
  await clearPowerPointPackages()
})

afterEach(async () => {
  await clearPowerPointPackages()
})

test('hydrates retained PowerPoint bytes and manifests from IndexedDB after a new runtime store is created', async () => {
  const backing = await createPowerPointPackageBacking(await fixture(), 'reload-fixture.pptx')
  const importingStore = new PowerPointPackageBackingStore()
  await importingStore.persist(backing)

  const restoredStore = new PowerPointPackageBackingStore([backing.reference])
  await restoredStore.ready()

  expect(restoredStore.getRestoreIssues()).toEqual([])
  expect(restoredStore.readBytes(backing.reference.packageId)).toEqual(backing.bytes)
  expect(restoredStore.getManifest(backing.reference.packageId)).toEqual(backing.manifest)
})
