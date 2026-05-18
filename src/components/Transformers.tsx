import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { PageContainer, PageContent, PageHeader } from '@/components/PageLayout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useConfig } from './ConfigProvider'
import { TransformerList } from './TransformerList'

const transformerSchema = z.object({
  path: z.string().min(1),
  options: z.array(z.object({ key: z.string(), value: z.string() })),
})

type TransformerFormValues = z.infer<typeof transformerSchema>

function TransformerEditDialog({
  open,
  transformer,
  onSave,
  onCancel,
}: {
  open: boolean
  transformer: { path: string; options?: Record<string, string> } | null
  onSave: (values: TransformerFormValues) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()

  const form = useForm<TransformerFormValues>({
    resolver: zodResolver(transformerSchema),
    defaultValues: { path: '', options: [] },
  })

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'options' })

  useEffect(() => {
    if (!open || !transformer) return
    form.reset({
      path: transformer.path ?? '',
      options: Object.entries(transformer.options ?? {}).map(([key, value]) => ({ key, value })),
    })
  }, [open, transformer, form])

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('transformers.edit')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className='space-y-4'>
            <FormField
              control={form.control}
              name='path'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('transformers.path')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>{t('transformers.parameters')}</span>
                <Button type='button' variant='outline' size='sm' onClick={() => append({ key: '', value: '' })}>
                  <Plus className='h-4 w-4' />
                </Button>
              </div>
              {fields.map((field, index) => (
                <div key={field.id} className='flex items-center gap-2'>
                  <FormField
                    control={form.control}
                    name={`options.${index}.key`}
                    render={({ field }) => (
                      <FormItem className='flex-1'>
                        <FormControl>
                          <Input {...field} placeholder='key' />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`options.${index}.value`}
                    render={({ field }) => (
                      <FormItem className='flex-1'>
                        <FormControl>
                          <Input {...field} placeholder='value' />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type='button' variant='outline' size='icon' onClick={() => remove(index)}>
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={onCancel}>
                {t('app.cancel')}
              </Button>
              <Button type='submit'>{t('app.save')}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function Transformers() {
  const { t } = useTranslation()
  const { config, setConfig } = useConfig()
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null)

  if (!config) {
    return (
      <PageContainer>
        <PageHeader title={t('transformers.title')} />
        <PageContent className='flex items-center justify-center'>
          <div className='text-muted-foreground'>Loading transformers configuration...</div>
        </PageContent>
      </PageContainer>
    )
  }

  const transformers = Array.isArray(config.transformers) ? config.transformers : []
  const editingTransformer = editingIndex !== null ? (transformers[editingIndex] ?? { path: '', options: {} }) : null

  const handleSave = (values: TransformerFormValues) => {
    const options = Object.fromEntries(values.options.map(({ key, value }) => [key, value]))
    const updated = [...transformers]
    if (editingIndex !== null && editingIndex < transformers.length) {
      updated[editingIndex] = { ...updated[editingIndex], path: values.path, options }
    } else {
      updated.push({ path: values.path, options })
    }
    setConfig({ ...config, transformers: updated })
    setEditingIndex(null)
  }

  const handleRemove = (index: number) => {
    const updated = [...transformers]
    updated.splice(index, 1)
    setConfig({ ...config, transformers: updated })
    setDeletingIndex(null)
  }

  return (
    <PageContainer>
      <PageHeader title={`${t('transformers.title')} (${transformers.length})`}>
        <Button onClick={() => setEditingIndex(transformers.length)}>{t('transformers.add')}</Button>
      </PageHeader>
      <PageContent>
        <TransformerList transformers={transformers} onEdit={setEditingIndex} onRemove={setDeletingIndex} />
      </PageContent>

      <TransformerEditDialog
        open={editingIndex !== null}
        transformer={editingTransformer}
        onSave={handleSave}
        onCancel={() => setEditingIndex(null)}
      />

      <Dialog open={deletingIndex !== null} onOpenChange={() => setDeletingIndex(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('transformers.delete')}</DialogTitle>
            <DialogDescription>{t('transformers.delete_transformer_confirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeletingIndex(null)}>
              {t('app.cancel')}
            </Button>
            <Button variant='destructive' onClick={() => deletingIndex !== null && handleRemove(deletingIndex)}>
              {t('app.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
