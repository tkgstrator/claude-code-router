interface ModuleTypeOption {
  label: string
  value: string
}

interface ModuleTypeListProps {
  title: string
  options: ModuleTypeOption[]
}

// Left column: draggable list of module types the user can drop onto the preview area.
export function ModuleTypeList({ title, options }: ModuleTypeListProps) {
  return (
    <div className='border rounded-lg flex flex-col overflow-hidden col-span-1'>
      <h3 className='text-sm font-medium p-4 pb-0 mb-3'>{title}</h3>
      <div className='space-y-2 overflow-y-auto px-4 pb-4 flex-1'>
        {options.map((moduleType) => (
          <div
            key={moduleType.value}
            className='flex items-center gap-2 p-2 border rounded cursor-move hover:bg-secondary'
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('moduleType', moduleType.value)
            }}
          >
            <span className='text-sm'>{moduleType.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
