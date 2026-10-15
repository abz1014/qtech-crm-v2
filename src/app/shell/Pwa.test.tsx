import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallBanner } from '@/features/settings/InstallBanner'
import { DISMISS_KEY, IOS_BANNER_KEY, IOS_HINT_KEY, initInstallCapture, resetInstallForTests } from '@/lib/pwa/install'
import { PwaPrompts } from '@/app/shell/PwaPrompts'
import { axeViolations } from '@/test/axe'
import { ToastProvider } from '@/ui/Toast'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

function fireInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn().mockResolvedValue(undefined)
  const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome }) })
  act(() => {
    window.dispatchEvent(e)
  })
  return { e, prompt }
}

afterEach(() => {
  window.localStorage.clear()
  resetInstallForTests()
  vi.restoreAllMocks()
})

describe('install banner (Android, beforeinstallprompt)', () => {
  it('stays hidden until the browser offers an install', () => {
    initInstallCapture()
    render(<InstallBanner />)
    expect(screen.queryByText('Install the app')).toBeNull()
  })

  it('shows quietly, is accessible, installs through the saved prompt', async () => {
    const user = userEvent.setup()
    initInstallCapture()
    const { container } = render(<InstallBanner />)
    const { e, prompt } = fireInstallEvent()
    expect(e.defaultPrevented).toBe(true)
    expect(await screen.findByText('Install the app')).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Install the app')).toBeNull()
  })

  it('"Not now" hides it and is remembered on this device', async () => {
    const user = userEvent.setup()
    initInstallCapture()
    const first = render(<InstallBanner />)
    fireInstallEvent()
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('Install the app')).toBeNull()
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe('1')
    first.unmount()
    render(<InstallBanner />)
    expect(screen.queryByText('Install the app')).toBeNull()
  })
})

describe('iPhone Safari hint', () => {
  function asIphone() {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI)
  }

  it('Settings banner explains Share, then Add to Home Screen, passes axe and can be dismissed', async () => {
    asIphone()
    const user = userEvent.setup()
    const { container } = render(<InstallBanner />)
    expect(screen.getByText('Add Q-Tech CRM to your home screen')).toBeInTheDocument()
    expect(container).toHaveTextContent('Share in Safari, then Add to Home Screen.')
    expect(await axeViolations(container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByText('Add Q-Tech CRM to your home screen')).toBeNull()
    expect(window.localStorage.getItem(IOS_BANNER_KEY)).toBe('1')
  })

  it('the toast hint shows once per device, then never again', () => {
    asIphone()
    const first = render(
      <ToastProvider>
        <PwaPrompts />
      </ToastProvider>,
    )
    expect(screen.getByText('Tap Share, then Add to Home Screen.')).toBeInTheDocument()
    expect(window.localStorage.getItem(IOS_HINT_KEY)).toBe('1')
    first.unmount()
    render(
      <ToastProvider>
        <PwaPrompts />
      </ToastProvider>,
    )
    expect(screen.queryByText('Tap Share, then Add to Home Screen.')).toBeNull()
  })

  it('shows nothing on other browsers', () => {
    render(
      <ToastProvider>
        <PwaPrompts />
        <InstallBanner />
      </ToastProvider>,
    )
    expect(screen.queryByText(/home screen/i)).toBeNull()
  })
})
