import { describe, expect, it } from 'vitest'
import { intakeFiles } from '@/lib/fileIntake'
import { RFQ_FILE_ACCEPT } from '@/features/rfqs/lib'

const MB = 1024 * 1024

describe('fileIntake for RFQ files (R10)', () => {
  it('accepts a HEIC photo, also when the phone gives it no type', async () => {
    const [typed, untyped, heif] = await intakeFiles(
      [
        new File([new Uint8Array(2000)], 'IMG_0412.heic', { type: 'image/heic' }),
        new File([new Uint8Array(2000)], 'IMG_0413.HEIC', { type: '' }),
        new File([new Uint8Array(2000)], 'IMG_0414.heif', { type: 'application/octet-stream' }),
      ],
      { accept: RFQ_FILE_ACCEPT },
    )
    expect(typed.error).toBeUndefined()
    expect(untyped.error).toBeUndefined()
    expect(untyped.file.type).toBe('image/heic')
    expect(heif.error).toBeUndefined()
    expect(heif.file.type).toBe('image/heif')
  })

  it('refuses a 6 MB file in plain words', async () => {
    const [big] = await intakeFiles([new File([new Uint8Array(6 * MB)], 'enquiry.pdf', { type: 'application/pdf' })], { accept: RFQ_FILE_ACCEPT })
    expect(big.error).toBe('6 MB. The limit is 5 MB.')
  })

  it('refuses a type that is not on the list, naming the ones that are', async () => {
    const [doc] = await intakeFiles([new File(['x'], 'sheet.xlsx', { type: 'application/vnd.ms-excel' })], { accept: RFQ_FILE_ACCEPT })
    expect(doc.error).toBe('Only PNG, JPG, HEIC, HEIF, PDF files can be added.')
  })
})
