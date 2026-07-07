// Mock variable data used to render the module preview area.
export const PREVIEW_VARIABLES: Record<string, string> = {
  workDirName: 'project',
  gitBranch: 'main',
  model: 'Claude Sonnet 4',
  inputTokens: '1.2k',
  outputTokens: '2.5k'
}

// Variable substitution helper
export function replaceVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return variables[varName] || match
  })
}
