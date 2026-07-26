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
    <div className='flex flex-col overflow-hidden col-span-1'>
      <h3 className='text-sm font-medium border-b pb-2 mb-3'>{title}</h3>
      <div className='divide-y overflow-y-auto flex-1'>
        {options.map((moduleType) => (
          <div
            key={moduleType.value}
            className='flex items-center gap-2 px-1 py-3 cursor-move hover:bg-muted/50 transition-colors'
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
