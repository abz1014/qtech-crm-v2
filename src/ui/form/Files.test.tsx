import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatBytes, intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { axeViolations } from '@/test/axe'
import { FileDrop } from '@/ui/form/FileDrop'
import { FileRow } from '@/ui/form/FileRow'

const png = (name: string, bytes = 1000) => new File([new Uint8Array(bytes)], name, { type: 'image/png' })

describe('fileIntake (U07)', () => {
  it('formats sizes', () => {
    expect(formatBytes(3.8 * 1024 * 1024)).toBe('3.8 MB')
    expect(formatBytes(640 * 1024)).toBe('640 KB')
    expect(formatBytes(10)).toBe('1 KB')
  })

  it('refuses a file over the limit with the reason, and a type that is not allowed', async () => {
    const [big, text] = await intakeFiles(
      [new File([new Uint8Array(7.2 * 1024 * 1024)], 'datasheet-scan.pdf', { type: 'application/pdf' }), new File(['x'], 'notes.txt', { type: 'text/plain' })],
      {},
    )
    expect(big.error).toBe('7.2 MB. The limit is 5 MB.')
    expect(text.error).toBe('Only PNG, JPG, PDF files can be added.')
  })

  it('a good file has no error and keeps its original size', async () => {
    const [ok] = await intakeFiles([png('a.png', 2048)])
    expect(ok.error).toBeUndefined()
    expect(ok.originalSize).toBe(2048)
  })
})

describe('FileDrop and FileRow (U07)', () => {
  it('Choose files reports the files; resting state names the limit and the paste keys', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn<(f: AddedFile[]) => void>()
    const { container } = render(<FileDrop onAdd={onAdd} />)
    expect(screen.getByText('Drop files here')).toBeInTheDocument()
    expect(screen.getByText(/up to 5 MB each/)).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
    await user.upload(screen.getByLabelText('Choose files', { selector: 'input' }), png('plate.png'))
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0][0].file.name).toBe('plate.png')
  })

  it('drag over shows "Release to add 2 files"; dropping adds them', async () => {
    const onAdd = vi.fn<(f: AddedFile[]) => void>()
    render(<FileDrop onAdd={onAdd} />)
    const zone = screen.getByRole('group', { name: 'Add files' })
    const files = [png('a.png'), png('b.png')]
    const dataTransfer = { types: ['Files'], items: files, files }
    fireEvent.dragEnter(zone, { dataTransfer })
    expect(await screen.findByText('Release to add 2 files')).toBeInTheDocument()
    fireEvent.drop(zone, { dataTransfer })
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0][0]).toHaveLength(2)
    expect(screen.getByText('Drop files here')).toBeInTheDocument()
  })

  it('a pasted file anywhere on the page is added; paste inside a field is left alone', async () => {
    const onAdd = vi.fn<(f: AddedFile[]) => void>()
    render(
      <>
        <input aria-label="note" />
        <FileDrop onAdd={onAdd} />
      </>,
    )
    const file = png('shot.png')
    fireEvent.paste(document.body, { clipboardData: { files: [file] } })
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    fireEvent.paste(screen.getByLabelText('note'), { clipboardData: { files: [file] } })
    await new Promise(r => setTimeout(r, 50))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('FileRow shows the shrink note, the error reason, and a named remove button', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const compressed = { id: '1', file: new File([new Uint8Array(640 * 1024)], 'nameplate-flowmeter.jpg', { type: 'image/jpeg' }), originalSize: 3.8 * 1024 * 1024 }
    const bad = { id: '2', file: new File([''], 'datasheet-scan.pdf', { type: 'application/pdf' }), originalSize: 0, error: '7.2 MB. The limit is 5 MB.' }
    const { container } = render(
      <>
        <FileRow item={compressed} onRemove={onRemove} />
        <FileRow item={bad} onRemove={() => {}} />
      </>,
    )
    expect(screen.getByText('3.8 MB → 640 KB')).toBeInTheDocument()
    expect(screen.getByText('7.2 MB. The limit is 5 MB.')).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Remove nameplate-flowmeter.jpg' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
