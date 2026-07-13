import React, { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'

// Icon search input component
interface IconData {
  className: string
  unicode: string
  char: string
}

interface IconSearchInputProps {
  value: string
  onChange: (value: string) => void
  fontFamily: string
  t: (key: string) => string
}

export const IconSearchInput = React.memo(({ value, onChange, fontFamily, t }: IconSearchInputProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState(value)
  const [icons, setIcons] = useState<IconData[]>([])
  const [filteredIcons, setFilteredIcons] = useState<IconData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Load Nerd Fonts icon data
  const loadIcons = useCallback(async () => {
    if (icons.length > 0) return // Already loaded

    setIsLoading(true)
    try {
      const response = await fetch('https://www.nerdfonts.com/assets/css/combo.css')
      const cssText = await response.text()

      // Parse icon class names and Unicode codepoints from the CSS
      const iconRegex = /\.nf-([a-zA-Z0-9_-]+):before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)";?\s*\}/g
      const iconData: IconData[] = []
      let match: RegExpExecArray | null = iconRegex.exec(cssText)

      while (match !== null) {
        const className = `nf-${match[1]}`
        const unicode = match[2]
        const char = String.fromCharCode(parseInt(unicode, 16))
        iconData.push({ className, unicode, char })
        match = iconRegex.exec(cssText)
      }

      setIcons(iconData)
      setFilteredIcons(iconData.slice(0, 200))
    } catch (error) {
      console.error('Failed to load icons:', error)
      setIcons([])
      setFilteredIcons([])
    } finally {
      setIsLoading(false)
    }
  }, [icons.length])

  // Fuzzy-search icons
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredIcons(icons.slice(0, 100)) // Show the first 100 icons
      return
    }

    const term = searchTerm.toLowerCase()
    let filtered = icons

    // If the input is a special character (likely a pasted icon glyph), look up the matching icon
    if (term.length === 1 || /[\u{2000}-\u{2FFFF}]/u.test(searchTerm)) {
      const pastedIcon = icons.find((icon) => icon.char === searchTerm)
      if (pastedIcon) {
        filtered = [pastedIcon]
      } else {
        // Search icons that contain this character
        filtered = icons.filter((icon) => icon.char === searchTerm)
      }
    } else {
      // Fuzzy search: match against the class name and a simplified form
      filtered = icons.filter((icon) => {
        const className = icon.className.toLowerCase()
        const simpleClassName = className.replace(/[_-]/g, '')
        const simpleTerm = term.replace(/[_-]/g, '')

        return (
          className.includes(term) ||
          simpleClassName.includes(simpleTerm) ||
          // Keyword match
          term.split(' ').every((keyword) => className.includes(keyword) || simpleClassName.includes(keyword))
        )
      })
    }

    setFilteredIcons(filtered.slice(0, 120)) // Show more results
  }, [searchTerm, icons])

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchTerm(newValue)
    onChange(newValue)

    // Always open the dropdown so the user can search or confirm pasted content
    setIsOpen(true)
    if (icons.length === 0) {
      loadIcons()
    }
  }

  // Handle paste events
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text')

    // If a single character (likely an icon glyph), accept it and open the dropdown to show matches
    if (pastedText && pastedText.length === 1) {
      setTimeout(() => {
        setIsOpen(true)
      }, 10)
    }
  }

  // Select an icon
  const handleIconSelect = (iconChar: string) => {
    setSearchTerm(iconChar)
    onChange(iconChar)
    setIsOpen(false)
    inputRef.current?.focus()
  }

  // Handle focus events
  const handleFocus = () => {
    setIsOpen(true)
    if (icons.length === 0) {
      loadIcons()
    }
  }

  // Handle blur (delay closing so icon clicks still register)
  const handleBlur = () => {
    setTimeout(() => setIsOpen(false), 200)
  }

  return (
    <div className='relative'>
      <div className='relative'>
        <Input
          ref={inputRef}
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={t('statusline.icon_placeholder')}
          style={{ fontFamily: fontFamily + ', monospace' }}
          className='text-lg pr-2'
        />
      </div>
      {isOpen && (
        <div className='absolute z-50 mt-1 w-full max-h-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg'>
          {isLoading ? (
            <div className='flex items-center justify-center p-8'>
              <svg className='animate-spin h-6 w-6 text-primary' viewBox='0 0 24 24'>
                <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' fill='none' opacity='0.1' />
                <path
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                />
              </svg>
            </div>
          ) : (
            <>
              <div className='grid grid-cols-5 gap-2 p-2 max-h-72 overflow-y-auto'>
                {filteredIcons.map((icon) => (
                  <div
                    key={icon.className}
                    className='flex items-center justify-center p-3 text-2xl cursor-pointer hover:bg-secondary rounded transition-colors'
                    onClick={() => handleIconSelect(icon.char)}
                    onMouseDown={(e) => e.preventDefault()} // Prevent the input from losing focus
                    title={`${icon.char} - ${icon.className}`}
                    style={{ fontFamily: fontFamily + ', monospace' }}
                  >
                    {icon.char}
                  </div>
                ))}
                {filteredIcons.length === 0 && (
                  <div className='col-span-5 flex flex-col items-center justify-center p-8 text-muted-foreground'>
                    <svg
                      width='24'
                      height='24'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      className='mb-2'
                    >
                      <circle cx='11' cy='11' r='8' />
                      <path d='m21 21-4.35-4.35' />
                    </svg>
                    <div className='text-sm'>
                      {searchTerm
                        ? `${t('statusline.no_icons_found')} "${searchTerm}"`
                        : t('statusline.no_icons_available')}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
})
