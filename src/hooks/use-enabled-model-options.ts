import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'

interface EnabledModel {
  provider: string
  model: string
}

interface ModelOption {
  value: string
  label: string
}

export function useEnabledModelOptions() {
  const [models, setModels] = useState<EnabledModel[]>([])

  useEffect(() => {
    api
      .get<{ models: EnabledModel[] }>('/models')
      .then((data) => setModels(data.models))
      .catch((err) => console.error('Failed to load enabled models:', err))
  }, [])

  return useMemo<ModelOption[]>(
    () =>
      models.map(({ provider, model }) => ({
        value: `${provider},${model}`,
        label: `${provider}, ${model}`
      })),
    [models]
  )
}
