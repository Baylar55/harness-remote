import assert from 'node:assert/strict'
import { groupModels, modelOptionKey } from './components/model-picker.tsx'

// The catalog owns variant ordering. These labels are intentionally non-alphabetical and are
// treated as opaque values: the UI must preserve the order supplied by the harness rather than
// infer reasoning semantics from their names.
const catalogVariantOrder = ['medium', 'low', 'xhigh', 'high']
const catalog = [
  {
    providerID: 'openai',
    providerName: 'OpenAI',
    modelID: 'gpt-5.6',
    modelName: 'GPT-5.6',
    isDefault: true
  },
  ...catalogVariantOrder.map((variant) => ({
    providerID: 'openai',
    providerName: 'OpenAI',
    modelID: 'gpt-5.6',
    modelName: 'GPT-5.6',
    variant
  })),
  {
    providerID: 'anthropic',
    providerName: 'Anthropic',
    modelID: 'claude-sonnet',
    modelName: 'Claude Sonnet'
  },
  {
    providerID: 'anthropic',
    providerName: 'Anthropic',
    modelID: 'claude-sonnet',
    modelName: 'Claude Sonnet',
    variant: 'thinking'
  }
]

const groups = groupModels(catalog)
const openAI = groups.find((group) => group.providerID === 'openai' && group.modelID === 'gpt-5.6')
const anthropic = groups.find((group) => group.providerID === 'anthropic' && group.modelID === 'claude-sonnet')

assert.ok(openAI, 'the base model and its variants must remain one model group')
assert.ok(anthropic, 'a second model family must remain separate')
assert.equal(modelOptionKey(openAI.base), 'openai|gpt-5.6|')
assert.deepEqual(
  openAI.variants.map((variant) => variant.variant),
  catalogVariantOrder,
  'reasoning/variant order must be exactly the order advertised by the harness catalog'
)
assert.deepEqual(anthropic.variants.map((variant) => variant.variant), ['thinking'])

console.log('model picker variant ordering behavioral tests passed')
