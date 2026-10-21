import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/ui/Button'
import { ChannelLink } from '@/ui/ChannelLink'
import { DetailHeader } from '@/ui/DetailHeader'
import { MoreMenu } from '@/ui/MoreMenu'
import { PageHeader } from '@/ui/PageHeader'
import { MenuItem } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { ToastProvider } from '@/ui/Toast'
import * as links from '@/lib/messageLinks'

afterEach(() => vi.restoreAllMocks())

/* Round-2 spec 5.5: one test per page template. */
describe('PageHeader (list pages)', () => {
  it('renders the h1 hidden on phones only, the lede, and one primary + one secondary', () => {
    render(
      <PageHeader
        title="Orders"
        lede="4 need you · 7 waiting"
        primary={<Button variant="primary">New order</Button>}
        secondary={<Button>Reports</Button>}
      />,
    )
    const h1 = screen.getByRole('heading', { level: 1, name: 'Orders' })
    expect(h1.className).toContain('max-md:sr-only')
    expect(screen.getByText('4 need you · 7 waiting')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Reports', 'New order'])
  })

  it('throws in development with two primaries, or a green secondary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <PageHeader
          title="RFQs"
          primary={
            <>
              <Button variant="primary">New RFQ</Button>
              <Button variant="primary">Paste or photo</Button>
            </>
          }
        />,
      ),
    ).toThrow(/at most one primary/)
    expect(() => render(<PageHeader title="RFQs" secondary={<Button variant="primary">New RFQ</Button>} />)).toThrow(/must not be a primary/)
  })
})

describe('DetailHeader (detail pages)', () => {
  it('h1 is name + code, never a chip; More is the only thing on the right; meta joined with ·', () => {
    render(
      <MemoryRouter>
        <DetailHeader
          name="Indus Textile Mills"
          nameHref="/companies/c1"
          code="RFQ-0177"
          breadcrumb={[{ label: 'RFQs', to: '/rfqs' }, { label: 'RFQ-0177', mono: true }]}
          chips={<StatusBadge dimension="deadline" value="overdue" />}
          meta={['Received 3 Oct', null, 'Ayesha Rana', 'Customer ref PO-88']}
          more={
            <MoreMenu>
              <MenuItem>Edit</MenuItem>
            </MoreMenu>
          }
        >
          <section aria-label="Next step">Send the quotation</section>
        </DetailHeader>
      </MemoryRouter>,
    )
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveAccessibleName('Indus Textile Mills RFQ-0177')
    expect(h1.querySelector('[data-status]')).toBeNull()
    expect(within(h1).getByRole('link', { name: 'Indus Textile Mills' })).toHaveAttribute('href', '/companies/c1')
    expect(within(h1).getByText('RFQ-0177').className).toContain('max-md:hidden')
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.getByText('Ayesha Rana').closest('p')?.textContent).toBe('Received 3 Oct·Ayesha Rana·Customer ref PO-88')
    expect(screen.getByRole('region', { name: 'Next step' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).className).toContain('max-md:hidden')
  })

  it('throws in development with more than 2 chips', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <DetailHeader
          name="X"
          chips={
            <>
              <span>a</span>
              <span>b</span>
              <span>c</span>
            </>
          }
        />,
      ),
    ).toThrow(/at most 2 status chips/)
  })
})

describe('MoreMenu', () => {
  it('desktop: a "More" text button; touch: an icon button named by its label; both open a menu', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <MoreMenu>
        <MenuItem>Cancel order</MenuItem>
      </MoreMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(within(await screen.findByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Cancel order' })).toBeInTheDocument()
    unmount()
    render(
      <MoreMenu touch label="More for RFQ-0177" side="top">
        <MenuItem>Cancel order</MenuItem>
      </MoreMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'More for RFQ-0177' }))
    expect(await screen.findByRole('menu', { name: 'More for RFQ-0177' })).toBeInTheDocument()
  })
})

describe('StickyActionBar (phone detail pages)', () => {
  it('is a fixed, phone-only toolbar with the primary first, then the secondary and More', () => {
    render(
      <StickyActionBar
        label="RFQ actions"
        primary={<Button variant="primary" size="touch">Issue quotation</Button>}
        secondary={<Button size="touch">Chase</Button>}
        more={
          <MoreMenu touch side="top">
            <MenuItem>Edit</MenuItem>
          </MoreMenu>
        }
      />,
    )
    const bar = screen.getByRole('toolbar', { name: 'RFQ actions' })
    expect(bar.className).toMatch(/fixed/)
    expect(bar.className).toMatch(/md:hidden/)
    expect(bar.className).toMatch(/safe-area-inset-bottom/)
    expect(within(bar).getAllByRole('button').map(b => b.textContent || b.getAttribute('aria-label'))).toEqual(['Issue quotation', 'Chase', 'More actions'])
  })
})

describe('ChannelLink', () => {
  it('shows the other channel as a link; with `open`, an "Open in …" button for the chosen one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onOpen = vi.fn()
    const opened = vi.spyOn(links, 'openMessageLink').mockImplementation(() => {})
    render(
      <ToastProvider>
        <ChannelLink
          value="whatsapp"
          onChange={onChange}
          open={{ to: { name: 'Ahmed Raza', phone: '0300 1234567', email: 'a@x.pk' }, text: 'Kindly confirm', onOpen }}
        />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Email instead' }))
    expect(onChange).toHaveBeenCalledWith('email')
    await user.click(screen.getByRole('button', { name: 'Open in WhatsApp' }))
    expect(opened).toHaveBeenCalledWith(expect.stringContaining('wa.me'))
    expect(onOpen).toHaveBeenCalledWith('whatsapp')
  })
})
