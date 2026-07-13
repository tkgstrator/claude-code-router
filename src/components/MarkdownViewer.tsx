import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

// Shared Markdown renderer for every Markdown surface in the app (chat
// conversation bubbles, the update changelog, ...).
//
// Background-agnostic by design: body text inherits the container's color and
// every accent (code pill, rule, quote bar, table border) is derived from
// `currentColor` via `*-current/<alpha>`. That means it renders correctly on a
// normal surface AND on an inverted chat bubble (light text on `bg-primary`)
// without any per-surface variants — a hard-coded `text-foreground` would go
// invisible on the user's dark bubble.
//
// Raw HTML is intentionally NOT enabled (no rehype-raw): react-markdown escapes
// embedded markup by default, so untrusted content (a GitHub changelog, an
// assistant reply, a user turn) can never inject script or markup.
const components: Components = {
  h1: ({ children }) => <h1 className='mt-6 mb-3 text-xl font-semibold tracking-tight text-balance'>{children}</h1>,
  h2: ({ children }) => <h2 className='mt-6 mb-2 text-lg font-semibold tracking-tight text-balance'>{children}</h2>,
  h3: ({ children }) => <h3 className='mt-5 mb-2 text-base font-semibold'>{children}</h3>,
  h4: ({ children }) => <h4 className='mt-4 mb-1.5 text-sm font-semibold'>{children}</h4>,
  p: ({ children }) => <p className='my-2 leading-relaxed'>{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target='_blank'
      rel='noreferrer'
      className='font-medium underline underline-offset-2 hover:no-underline'
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className='my-2 ml-5 list-disc space-y-1 marker:opacity-60'>{children}</ul>,
  ol: ({ children }) => <ol className='my-2 ml-5 list-decimal space-y-1 marker:opacity-60'>{children}</ol>,
  li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className='my-3 border-l-2 border-current/25 pl-4 opacity-80 italic'>{children}</blockquote>
  ),
  hr: () => <hr className='my-4 border-current/15' />,
  strong: ({ children }) => <strong className='font-semibold'>{children}</strong>,
  em: ({ children }) => <em className='italic'>{children}</em>,
  // Inline code gets a pill; fenced blocks nest a <code> inside <pre>, where the
  // pre-scoped override below strips the pill so only the pre frames it.
  code: ({ children, className = '' }) => (
    <code className={`rounded bg-current/10 px-1.5 py-0.5 font-mono text-[0.85em] ${className}`}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className='my-3 overflow-x-auto rounded-md border border-current/15 bg-current/5 p-3 text-sm [&>code]:block [&>code]:bg-transparent [&>code]:p-0'>
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className='my-3 overflow-x-auto'>
      <table className='w-full border-collapse text-sm'>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className='border border-current/20 bg-current/5 px-3 py-1.5 text-left font-semibold'>{children}</th>
  ),
  td: ({ children }) => <td className='border border-current/20 px-3 py-1.5'>{children}</td>,
  img: ({ src, alt }) => (
    <img src={typeof src === 'string' ? src : undefined} alt={alt} className='my-3 max-w-full rounded-md' />
  )
}

interface MarkdownViewerProps {
  content: string
  className?: string
}

// Render a Markdown string. Text color and size are inherited from the parent,
// so the caller controls the surface; the first/last child margins are
// collapsed so the content sits flush inside whatever container it lands in.
export function MarkdownViewer({ content, className = '' }: MarkdownViewerProps) {
  return (
    <div className={`break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`}>
      {/* remark-breaks keeps single newlines as line breaks, matching how chat
          and GitHub comments read; remark-gfm adds tables / task-lists / etc. */}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
