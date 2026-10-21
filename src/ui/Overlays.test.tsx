import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { axeViolations } from '@/test/axe'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Tab, TabList, TabPanel, Tabs } from '@/ui/Tabs'
import { Tooltip } from '@/ui/Tooltip'

describe('Popover (U03)', () => {
  function Menu({ onItem }: { onItem: () => void }) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button>Snooze</Button>
        </PopoverTrigger>
        <PopoverContent variant="menu" aria-label="Snooze options">
          <MenuItem hint="Sat 28 Nov" onClick={onItem}>
            Snooze to tomorrow
          </MenuItem>
          <MenuItem hint="Mon 30 Nov">Snooze to Monday</MenuItem>
          <MenuSeparator />
          <MenuItem>Stop reminding me</MenuItem>
        </PopoverContent>
      </Popover>
    )
  }

  it('menu: opens on Enter, focuses the first item, arrows wrap, Enter runs and closes, focus returns to the trigger', async () => {
    const user = userEvent.setup()
    const onItem = vi.fn()
    render(<Menu onItem={onItem} />)
    const trigger = screen.getByRole('button', { name: 'Snooze' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const items = await screen.findAllByRole('menuitem')
    await waitFor(() => expect(items[0]).toHaveFocus())
    await user.keyboard('{ArrowUp}')
    expect(items[2]).toHaveFocus() // wraps
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onItem).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('Esc closes and returns focus; the open menu has no axe violations', async () => {
    const user = userEvent.setup()
    render(<Menu onItem={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Snooze' })
    await user.click(trigger)
    await screen.findByRole('menu')
    expect(await axeViolations()).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('information variant is a dialog-like popover that closes on Esc', async () => {
    const user = userEvent.setup()
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Indus Valve Traders</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Supplier summary">Quoted 4 of 6 enquiries</PopoverContent>
      </Popover>,
    )
    await user.click(screen.getByRole('button'))
    expect(await screen.findByText('Quoted 4 of 6 enquiries')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Quoted 4 of 6 enquiries')).toBeNull())
  })
})

describe('Tooltip (U03)', () => {
  it('shows at once on keyboard focus with its shortcut, and closes on Esc', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Capture" shortcut="C">
        <Button icon={Copy} aria-label="Capture" />
      </Tooltip>,
    )
    await user.tab()
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Capture')
    expect(tip).toHaveTextContent('C')
    expect(screen.getByRole('button', { name: 'Capture' })).toHaveAccessibleDescription('Capture C')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('explains a disabled control through a focusable wrapper', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip forDisabled content="Add the legal name and address in Settings before issuing a PDF.">
        <Button disabled>Issue quotation</Button>
      </Tooltip>,
    )
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add the legal name')
  })
})

describe('Tabs and SegmentedControl (U03)', () => {
  it('Tabs: tablist semantics, arrows move and select, needs-you pill, panel follows', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Tabs defaultValue="items">
        <TabList aria-label="RFQ sections">
          <Tab value="items">Items</Tab>
          <Tab value="suppliers">Suppliers</Tab>
          <Tab value="questions" needs={2}>
            Questions
          </Tab>
        </TabList>
        <TabPanel value="items">Item rows</TabPanel>
        <TabPanel value="suppliers">Supplier rows</TabPanel>
        <TabPanel value="questions">Question rows</TabPanel>
      </Tabs>,
    )
    expect(await axeViolations(container)).toEqual([])
    await user.tab()
    expect(screen.getByRole('tab', { name: 'Items' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Suppliers' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Supplier rows')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /Questions/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Questions/ })).toHaveTextContent('2')
    expect(screen.getByRole('tab', { name: /^Questions\s*, 2 need you$/ })).toBeInTheDocument()
  })

  function Seg({ mode }: { mode: 'radio' | 'tabs' }) {
    const [v, setV] = useState('whatsapp')
    return (
      <SegmentedControl
        aria-label="Message channel"
        mode={mode}
        value={v}
        onValueChange={setV}
        options={[
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'email', label: 'Email' },
          { value: 'sms', label: 'SMS', disabled: true },
        ]}
      />
    )
  }

  it('radio mode: radiogroup, arrows move and set the value, skips disabled', async () => {
    const user = userEvent.setup()
    const { container } = render(<Seg mode="radio" />)
    expect(screen.getByRole('radiogroup', { name: 'Message channel' })).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
    await user.tab()
    expect(screen.getByRole('radio', { name: 'WhatsApp' })).toHaveFocus()
    // Radix moves focus on a timer after the key goes down, so the key is held until it lands.
    await user.keyboard('{ArrowRight>}')
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Email' })).toBeChecked())
    await user.keyboard('{/ArrowRight}{ArrowRight>}')
    await waitFor(() => expect(screen.getByRole('radio', { name: 'WhatsApp' })).toBeChecked()) // SMS is disabled, so it wraps
    await user.keyboard('{/ArrowRight}')
  })

  it('tabs mode: tablist, arrows move focus, Space or Enter selects', async () => {
    const user = userEvent.setup()
    render(<Seg mode="tabs" />)
    expect(screen.getByRole('tablist', { name: 'Message channel' })).toBeInTheDocument()
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Email' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'WhatsApp' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('tab', { name: 'Email' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Breadcrumb (U03)', () => {
  it('links ancestors, marks the current page, hides the separators from assistive tech', async () => {
    const { container } = render(
      <MemoryRouter>
        <Breadcrumb
          items={[
            { label: 'RFQs', to: '/rfqs' },
            { label: 'RFQ-0177', to: '/rfqs/177', mono: true },
            { label: 'Item 2' },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'RFQs' })).toHaveAttribute('href', '/rfqs')
    expect(screen.getByText('Item 2')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'RFQ-0177' }).className).toMatch(/\bnum\b/)
    expect(await axeViolations(container)).toEqual([])
  })
})
