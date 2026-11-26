import { Fragment } from 'react'

/** A value range with its unit: "0-10 bar", "4-20 mA", "10 - 30 °C". */
const RANGE = /(\d+(?:[.,]\d+)?\s?[-–]\s?\d+(?:[.,]\d+)?(?:\s?[a-zA-Zµ°%]+)?)/

/**
 * An item's words with every value range kept on one line: the browser breaks a line after a hyphen, so "0-10 bar" came out as
 * "0-" and "10 bar" (screen review 26). The range is drawn in a nowrap span; the text itself (what is copied, searched and read
 * aloud) is unchanged.
 */
export function SpecText({ children }: { children: string }) {
  const parts = children.split(RANGE)
  if (parts.length === 1) return <>{children}</>
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="whitespace-nowrap">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}
