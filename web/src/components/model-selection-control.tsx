import { useMemo, useState } from "react"
import type { ModelOption, ModelSelection } from "../types"

export type ModelSelectionLabels = {
  select: string
  searchPlaceholder: string
  searchEmpty: string
  defaultBadge: string
  provider: (provider: string) => string
  context: (context: string, output: string) => string
  toolsYes: string
  toolsNo: string
  variant: (variant: string) => string
}

type Props = {
  options: ModelOption[]
  value: ModelSelection | null
  onChange: (value: ModelOption) => void
  disabled?: boolean
  labels: ModelSelectionLabels
}

function sameModel(left: ModelSelection | null, right: ModelSelection): boolean {
  return Boolean(left)
    && left!.providerID === right.providerID
    && left!.modelID === right.modelID
    && (left!.variant || "") === (right.variant || "")
}

function formatLimit(value?: number): string {
  if (!value) return "-"
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

/**
 * This control preserves the mature HR3 model picker semantics for Native Session detail. Harness
 * adapters already expose variants as ModelOption rows, so effort stays part of the same selection
 * rather than becoming a Session-first-only control with different semantics.
 */
export function ModelSelectionControl({ options, value, onChange, disabled = false, labels }: Props) {
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLowerCase()
  const filtered = useMemo(() => normalized
    ? options.filter((option) => [
        option.modelName,
        option.modelID,
        option.providerName,
        option.providerID,
        option.description,
        option.variant
      ].some((candidate) => candidate?.toLowerCase().includes(normalized)))
    : options, [options, normalized])
  const active = value ? options.find((option) => sameModel(value, option)) ?? null : null

  return (
    <div className="model-controls">
      <label>
        {labels.select}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.searchPlaceholder}
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          autoComplete="off"
        />
      </label>
      <div className="model-option-list" role="listbox" aria-label={labels.select}>
        {filtered.length > 0 ? filtered.map((option) => {
          const selected = sameModel(value, option)
          const key = `${option.providerID}\u0000${option.modelID}\u0000${option.variant || ""}`
          return (
            <button
              type="button"
              key={key}
              className={selected ? "model-option active" : "model-option"}
              onClick={() => onChange(option)}
              disabled={disabled}
              role="option"
              aria-selected={selected}
            >
              <span>
                <strong>{option.modelName}</strong>
                <small>{[option.description ?? option.providerName, option.variant].filter(Boolean).join(" · ")}</small>
              </span>
              {option.isDefault ? <em>{labels.defaultBadge}</em> : null}
            </button>
          )
        }) : <p className="subtle model-empty">{labels.searchEmpty}</p>}
      </div>
      {active ? (
        <div className="model-meta">
          <span>{labels.provider(active.providerName)}</span>
          <span>{labels.context(formatLimit(active.contextLimit), formatLimit(active.outputLimit))}</span>
          <span>{active.tools ? labels.toolsYes : labels.toolsNo}</span>
          {active.variant ? <span>{labels.variant(active.variant)}</span> : null}
        </div>
      ) : null}
    </div>
  )
}