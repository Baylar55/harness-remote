import { useEffect, useRef, useState } from "react"
import { api } from "../api"
import { CheckIcon, CloseIcon, LoadingIcon, PencilIcon } from "../Icons"
import type { NativeSessionSurfaceTarget } from "../native-session-discovery"
import type { Session } from "../types"
import { useTranslator } from "../useTranslator"

/**
 * Renaming a Session is editing the thing you are looking at, so it happens on the thing you are
 * looking at.
 *
 * The previous implementation opened a modal panel with its own heading, its own field labelled
 * "Session name" and its own pair of buttons, to change one short string that was already on screen
 * two centimetres above it. That is three layers of chrome around a single-line edit: the user has
 * to find the new title's field, and the title they are replacing is hidden behind the panel while
 * they type. Every editor this app is compared against - Linear, Notion, GitHub, the harness CLIs'
 * own web surfaces - makes the heading itself editable instead.
 *
 * The heading is therefore the input. Its typography, box and position are identical in both states,
 * so committing a rename does not make the header move, and Escape restores the previous value
 * without anything else on screen having changed. Keyboard commits with Enter, cancels with Escape,
 * and a blur commits the same way clicking away from a renamed file does elsewhere.
 */
type Props = {
  target: NativeSessionSurfaceTarget
  onRenamed: (session: Session, title: string) => void
}

export function NativeSessionTitle({ target, onRenamed }: Props) {
  const t = useTranslator()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A blur that happens *because* the rename is being committed or cancelled must not run the blur
  // handler a second time and re-commit an already-settled edit.
  const settledRef = useRef(false)

  // Switching Session while a rename is open would otherwise point a half-typed title at the
  // Session the user has just navigated to.
  useEffect(() => {
    setEditing(false)
    setBusy(false)
    setError(null)
  }, [target.key])

  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  if (!target.renameSupported) return <h1 className="hr-native-session-title">{target.title}</h1>

  function beginEdit() {
    if (busy) return
    settledRef.current = false
    setError(null)
    setTitle(target.title === "Untitled Session" ? "" : target.title)
    setEditing(true)
  }

  function cancelEdit() {
    settledRef.current = true
    setEditing(false)
    setError(null)
  }

  async function commit() {
    if (busy) return
    const nextTitle = title.replace(/[\r\n]+/g, " ").trim()
    if (!nextTitle) {
      setError(t("sf.enterSessionName"))
      inputRef.current?.focus()
      return
    }
    if (nextTitle === target.title) {
      cancelEdit()
      return
    }
    settledRef.current = true
    setBusy(true)
    setError(null)
    try {
      const session = await api.renameSession(target.config, target.sessionID, nextTitle, target.directory)
      setEditing(false)
      onRenamed(session, nextTitle)
    } catch (reason) {
      // The edit stays open with the text the user typed: a failed write must not also lose it.
      settledRef.current = false
      setError(reason instanceof Error ? reason.message : String(reason))
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <h1 className="hr-native-session-title">
        <button
          type="button"
          className="hr-native-session-title-button"
          onClick={beginEdit}
          title={t("sf.renameSession")}
          aria-label={t("sf.renameSessionNamed", { title: target.title })}
        >
          <span>{target.title}</span>
          <PencilIcon size={13} />
        </button>
      </h1>
    )
  }

  return (
    <h1 className={`hr-native-session-title editing${busy ? " busy" : ""}`}>
      <span className="hr-native-session-title-field">
        <input
          ref={inputRef}
          value={title}
          disabled={busy}
          maxLength={200}
          spellCheck={false}
          aria-label={t("sf.sessionName")}
          aria-invalid={error ? true : undefined}
          title={t("sf.renameHint")}
          onChange={(event) => { setTitle(event.target.value); if (error) setError(null) }}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void commit() }
            else if (event.key === "Escape") { event.preventDefault(); cancelEdit() }
          }}
          onBlur={() => {
            // Both buttons live inside this element, so a click on Save or Cancel blurs the input
            // first. `settledRef` and the relatedTarget check keep that click from being swallowed.
            if (settledRef.current || busy) return
            window.setTimeout(() => {
              if (settledRef.current || busy || !inputRef.current) return
              if (inputRef.current.parentElement?.contains(document.activeElement)) return
              void commit()
            }, 0)
          }}
        />
        <span className="hr-native-session-title-actions">
          {busy ? <LoadingIcon size={14} /> : (
            <>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void commit()} title={t("sf.rename")} aria-label={t("sf.rename")}><CheckIcon size={13} /></button>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={cancelEdit} title={t("sf.cancel")} aria-label={t("sf.cancel")}><CloseIcon size={13} /></button>
            </>
          )}
        </span>
      </span>
      {/* Only an error takes a line of its own. A permanent hint line under the field would make the
          header taller the moment editing starts, which moves the whole conversation down by the
          height of that line and back up again on commit. */}
      {error ? <small className="hr-native-session-title-error" role="alert">{error}</small> : null}
    </h1>
  )
}
