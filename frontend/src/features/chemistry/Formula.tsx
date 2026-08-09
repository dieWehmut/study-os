import { Fragment, type ReactNode } from "react"

/**
 * A chemical formula, set the way it is printed.
 *
 * H<sub>2</sub>O rather than H2O is not decoration: the digit after an element
 * and the digit in front of the whole formula mean different things, and a
 * line of plain text renders them identically. 2H2O is two molecules of H₂O.
 *
 * Charges are written ^2- or ^+ on the way in, because there is no way to tell
 * SO4 2- from SO42- once the caret is gone.
 */
export function Formula({ value, className }: { value: string; className?: string }) {
  return (
    // The label carries the source text, so a screen reader says the formula
    // rather than reading the subscript as a run of its own.
    <span aria-label={value} className={className}>
      {parts(value).map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </span>
  )
}

function parts(value: string): ReactNode[] {
  const out: ReactNode[] = []
  let plain = ""
  let index = 0
  // A digit is a subscript only when something it can attach to came before
  // it. At the start of the formula, or after a +, it is a coefficient.
  let attachable = false

  const flush = () => {
    if (plain !== "") {
      out.push(plain)
      plain = ""
    }
  }

  while (index < value.length) {
    const character = value[index] as string

    if (character === "^") {
      let charge = ""
      index += 1
      while (index < value.length && /[0-9+-]/.test(value[index] as string)) {
        charge += value[index]
        index += 1
      }
      flush()
      out.push(<sup className="text-[0.7em]">{charge}</sup>)
      continue
    }

    if (/[0-9]/.test(character) && attachable) {
      let digits = ""
      while (index < value.length && /[0-9]/.test(value[index] as string)) {
        digits += value[index]
        index += 1
      }
      flush()
      out.push(<sub className="text-[0.7em]">{digits}</sub>)
      continue
    }

    plain += character
    index += 1
    // A closing bracket can carry a subscript -- Ca(OH)2 -- and so can a
    // letter. A + resets, because what follows it starts a new species.
    attachable = /[A-Za-z)\]）]/.test(character)
  }

  flush()
  return out
}
