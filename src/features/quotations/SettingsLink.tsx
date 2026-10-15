import { Link } from 'react-router-dom'

/** The plain link a blocked PDF points at: Settings, Company (where the legal name and address are filled in). */
export function SettingsLink() {
  return (
    <Link to="/settings/company" className="font-medium text-fg underline underline-offset-2 hover:text-fg-2">
      Open Settings, Company
    </Link>
  )
}
