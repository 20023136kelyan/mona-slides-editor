import { readFile } from 'node:fs/promises'

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import {
  createPowerPointPackageBacking,
} from '@/features/editor/editor-pptx-package'
import {
  PowerPointPackageBackingStore,
  type PowerPointPackagePersistence,
} from '@/features/editor/editor-pptx-backing-store'

const contentTypes = `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`

const relationships = (items: string) => `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`

const relationship = (id: string, type: string, target: string) => (
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
)

const fixture = async (): Promise<ArrayBuffer> => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="p" xmlns:r="r" xmlns:a="a"><p:sldIdLst><p:sldId id="512" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:defaultTextStyle><a:lvl1pPr defTabSz="457200"><a:defRPr sz="1200" lang="en-US"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', relationships([
    relationship('rId1', 'slide', 'slides/slide1.xml'),
    relationship('rId2', 'slide', 'slides/slide2.xml'),
  ].join('')))
  for (const index of [1, 2]) {
    zip.file(`ppt/slides/slide${index}.xml`, `<p:sld xmlns:p="p" xmlns:a="a" xmlns:a16="a16"${index === 1 ? ' showMasterSp="0" showMasterPhAnim="0"' : ''}>
      <p:cSld><p:spTree>
        <p:grpSp>
          <p:nvGrpSpPr><p:cNvPr id="2" name="Group ${index}"/></p:nvGrpSpPr>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="3" name="Title ${index}" descr="Accessible title">
              <a:extLst><a:ext uri="identity"><a16:creationId id="{creation-${index}}"/></a:ext></a:extLst>
            </p:cNvPr><p:nvPr><p:ph type="title" idx="1"/></p:nvPr></p:nvSpPr>
          </p:sp>
        </p:grpSp>
      </p:spTree></p:cSld>
    </p:sld>`)
    zip.file(`ppt/slides/_rels/slide${index}.xml.rels`, relationships(
      relationship('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
    ))
  }
  zip.file('ppt/slideLayouts/slideLayout1.xml', `<p:sldLayout xmlns:p="p" xmlns:a="a" name="Title layout" type="title" showMasterSp="0">
    <p:clrMapOvr><a:overrideClrMapping accent1="accent2" tx1="dk1"/></p:clrMapOvr>
  </p:sldLayout>`)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships(
    relationship('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'),
  ))
  zip.file('ppt/slideMasters/slideMaster1.xml', `<p:sldMaster xmlns:p="p" xmlns:a="a">
    <p:clrMap accent1="accent1" bg1="lt1" tx1="dk1"/>
    <p:hf dt="0" ftr="1" hdr="0" sldNum="1"/>
    <p:txStyles>
      <p:titleStyle><a:lvl1pPr algn="ctr" marL="12700"><a:defRPr sz="3200" b="1" lang="en-US"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
      <p:bodyStyle><a:lvl1pPr marL="25400" indent="-12700"><a:buChar char="•"/><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>
      <p:otherStyle/>
    </p:txStyles>
  </p:sldMaster>`)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships([
    relationship('rId1', 'theme', '../theme/theme1.xml'),
    relationship('rId2', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
  ].join('')))
  zip.file('ppt/theme/theme1.xml', `<a:theme xmlns:a="a" name="Fixture theme"><a:themeElements>
    <a:clrScheme name="Fixture colors"><a:dk1><a:srgbClr val="112233"/></a:dk1></a:clrScheme>
    <a:fontScheme name="Fixture fonts">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Yu Gothic"/><a:font script="Jpan" typeface="Yu Mincho"/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:cs typeface="Arial"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Fixture format"/>
  </a:themeElements></a:theme>`)
  zip.file('ppt/customXml/item1.xml', '<custom:future-feature xmlns:custom="custom"/>')
  return zip.generateAsync({ type: 'arraybuffer' })
}

describe('PowerPoint package backing', () => {
  it('retains the exact package and inventories unknown parts without flattening slide dependencies', async () => {
    const bytes = await fixture()
    const backing = await createPowerPointPackageBacking(bytes, 'fixture.pptx')

    expect(backing.reference.fileName).toBe('fixture.pptx')
    expect(backing.reference.byteLength).toBe(bytes.byteLength)
    expect(backing.reference.packageId).toMatch(/^pptx:[a-f0-9]{64}$/)
    const packageId = backing.reference.packageId
    expect(backing.reference.slides).toEqual([
      {
        layoutId: `${packageId}/ppt/slideLayouts/slideLayout1.xml`,
        layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
        masterId: `${packageId}/ppt/slideMasters/slideMaster1.xml`,
        masterPart: 'ppt/slideMasters/slideMaster1.xml',
        presentationSlideId: '512',
        relationshipId: 'rId2',
        showMasterPlaceholderAnimations: true,
        showMasterShapes: true,
        slidePart: 'ppt/slides/slide2.xml',
        themeId: `${packageId}/ppt/theme/theme1.xml`,
        themePart: 'ppt/theme/theme1.xml',
      },
      {
        layoutId: `${packageId}/ppt/slideLayouts/slideLayout1.xml`,
        layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
        masterId: `${packageId}/ppt/slideMasters/slideMaster1.xml`,
        masterPart: 'ppt/slideMasters/slideMaster1.xml',
        presentationSlideId: '256',
        relationshipId: 'rId1',
        showMasterPlaceholderAnimations: false,
        showMasterShapes: false,
        slidePart: 'ppt/slides/slide1.xml',
        themeId: `${packageId}/ppt/theme/theme1.xml`,
        themePart: 'ppt/theme/theme1.xml',
      },
    ])
    expect(backing.manifest.parts).toContainEqual({
      contentType: 'application/xml',
      kind: 'custom',
      path: 'ppt/customXml/item1.xml',
    })
    const slideObjects = backing.manifest.objects.filter(object => object.partPath === 'ppt/slides/slide1.xml')
    expect(slideObjects).toEqual([
      expect.objectContaining({
        kind: 'group',
        name: 'Group 1',
        nativeId: '2',
        sourceIndex: 0,
      }),
      expect.objectContaining({
        creationId: '{creation-1}',
        description: 'Accessible title',
        kind: 'shape',
        name: 'Title 1',
        nativeId: '3',
        parentStableId: slideObjects[0]?.stableId,
        placeholderIndex: '1',
        placeholderType: 'title',
        sourceIndex: 1,
      }),
    ])
    expect(slideObjects[0]?.stableId).toContain('/ppt/slides/slide1.xml#2')
    expect(backing.reference.hierarchy).toEqual({
      defaultTextStyle: [expect.objectContaining({
        level: 1,
        paragraph: expect.objectContaining({
          defaultRun: expect.objectContaining({
            fontFamily: '+mn-lt',
            fontSize: 12,
            language: 'en-US',
          }),
          defaultTabSize: 36,
        }),
        run: expect.objectContaining({
          fontFamily: '+mn-lt',
          fontSize: 12,
          language: 'en-US',
        }),
      })],
      layouts: [expect.objectContaining({
        colorMapOverride: { accent1: 'accent2', tx1: 'dk1' },
        masterId: expect.stringContaining('/ppt/slideMasters/slideMaster1.xml'),
        name: 'Title layout',
        showMasterShapes: false,
        type: 'title',
      })],
      masters: [expect.objectContaining({
        colorMap: { accent1: 'accent1', bg1: 'lt1', tx1: 'dk1' },
        headerFooter: {
          dateTime: false,
          footer: true,
          header: false,
          slideNumber: true,
        },
        layoutIds: [expect.stringContaining('/ppt/slideLayouts/slideLayout1.xml')],
        textStyles: {
          body: [expect.objectContaining({
            bulletCharacter: '•',
            fontSize: 18,
            indent: -1,
            level: 1,
            marginLeft: 2,
            paragraph: expect.objectContaining({
              bullet: { character: '•', type: 'character' },
              defaultRun: expect.objectContaining({ fontSize: 18 }),
              indent: -1,
              marginLeft: 2,
            }),
            run: expect.objectContaining({ fontSize: 18 }),
          })],
          other: [],
          title: [expect.objectContaining({
            alignment: 'ctr',
            bold: true,
            fontColor: { name: 'text', type: 'scheme', value: 'tx1' },
            fontFamily: '+mj-lt',
            fontSize: 32,
            language: 'en-US',
            level: 1,
            marginLeft: 1,
            paragraph: expect.objectContaining({
              alignment: 'ctr',
              defaultRun: expect.objectContaining({
                bold: true,
                color: { name: 'text', type: 'scheme', value: 'tx1' },
                fontFamily: '+mj-lt',
                fontSize: 32,
                language: 'en-US',
              }),
              marginLeft: 1,
            }),
            run: expect.objectContaining({
              bold: true,
              color: { name: 'text', type: 'scheme', value: 'tx1' },
              fontFamily: '+mj-lt',
              fontSize: 32,
              language: 'en-US',
            }),
          })],
        },
        themeId: expect.stringContaining('/ppt/theme/theme1.xml'),
      })],
      placeholders: expect.arrayContaining([
        expect.objectContaining({
          index: '1',
          objectId: expect.stringContaining('/ppt/slides/slide1.xml#3'),
          type: 'title',
        }),
      ]),
      themes: [expect.objectContaining({
        colorSchemeName: 'Fixture colors',
        colors: [{ name: 'dk1', type: 'srgb', value: '112233' }],
        formatSchemeName: 'Fixture format',
        majorFont: {
          eastAsian: 'Yu Gothic',
          latin: 'Aptos Display',
          supplemental: [{ script: 'Jpan', typeface: 'Yu Mincho' }],
        },
        majorLatinFont: 'Aptos Display',
        minorFont: {
          complexScript: 'Arial',
          latin: 'Aptos',
          supplemental: [],
        },
        minorLatinFont: 'Aptos',
        name: 'Fixture theme',
      })],
    })
    expect(new Uint8Array(bytes)).toEqual(backing.bytes)
  })

  it('addresses retained package bytes by content hash and returns defensive copies', async () => {
    const backing = await createPowerPointPackageBacking(await fixture(), 'fixture.pptx')
    const store = new PowerPointPackageBackingStore()
    store.put(backing)

    const first = store.readBytes(backing.reference.packageId)
    const second = store.readBytes(backing.reference.packageId)
    expect(first).toEqual(backing.bytes)
    expect(second).toEqual(backing.bytes)
    expect(first).not.toBe(second)
    first![0] = 0
    expect(store.readBytes(backing.reference.packageId)?.[0]).toBe(backing.bytes[0])
  })

  it('persists, re-hashes, hydrates, and prunes retained packages across store instances', async () => {
    const records = new Map<IDBValidKey, unknown>()
    const persistence: PowerPointPackagePersistence = {
      delete: async packageId => {
        records.delete(packageId)
        return undefined
      },
      listIds: async () => [...records.keys()],
      read: async packageId => records.get(packageId),
      write: async (packageId, value) => {
        records.set(packageId, structuredClone(value))
        return packageId
      },
    }
    const backing = await createPowerPointPackageBacking(await fixture(), 'durable.pptx')
    const first = new PowerPointPackageBackingStore([], persistence)
    await first.persist(backing)

    const restored = new PowerPointPackageBackingStore([backing.reference], persistence)
    await restored.ready()
    expect(restored.getRestoreIssues()).toEqual([])
    expect(restored.readBytes(backing.reference.packageId)).toEqual(backing.bytes)
    expect(restored.getManifest(backing.reference.packageId)?.objects).toEqual(backing.manifest.objects)

    await restored.retain([])
    expect(records.size).toBe(0)
    expect(restored.has(backing.reference.packageId)).toBe(false)
  })

  it('refuses to hydrate persisted bytes that no longer match their content-addressed ID', async () => {
    const records = new Map<IDBValidKey, unknown>()
    const persistence: PowerPointPackagePersistence = {
      delete: async packageId => {
        records.delete(packageId)
        return undefined
      },
      listIds: async () => [...records.keys()],
      read: async packageId => records.get(packageId),
      write: async (packageId, value) => {
        records.set(packageId, structuredClone(value))
        return packageId
      },
    }
    const backing = await createPowerPointPackageBacking(await fixture(), 'corrupt.pptx')
    const importingStore = new PowerPointPackageBackingStore([], persistence)
    await importingStore.persist(backing)
    const stored = records.get(backing.reference.packageId) as { bytes: Uint8Array }
    stored.bytes[0] = stored.bytes[0] === 0 ? 1 : 0

    const restored = new PowerPointPackageBackingStore([backing.reference], persistence)
    await restored.ready()

    expect(restored.has(backing.reference.packageId)).toBe(false)
    expect(restored.getRestoreIssues()).toEqual(['Corrupt retained PowerPoint package: corrupt.pptx'])
  })

  it('inventories the real chart-and-table corpus fixture without dropping non-rendered parts', async () => {
    const file = await readFile(new URL('../../../../../tests/corpus/public/corpus-04-chart-table.pptx', import.meta.url))
    const bytes = Uint8Array.from(file).buffer
    const backing = await createPowerPointPackageBacking(bytes, 'corpus-04-chart-table.pptx')

    expect(backing.reference.packageId).toBe('pptx:b4a80f27195886a363b16443bb3898d1c65384c7a93579cbef5ddad030d8bd5b')
    expect(backing.reference.slides).toHaveLength(1)
    expect(backing.manifest.parts.filter(part => part.kind === 'chart')).toHaveLength(3)
    expect(backing.manifest.parts.filter(part => part.kind === 'notes')).not.toHaveLength(0)
    expect(backing.manifest.relationships.some(relationship => relationship.type.endsWith('/chart'))).toBe(true)
  })
})
