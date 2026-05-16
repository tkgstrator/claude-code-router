import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execPromise = promisify(exec)

export async function checkForUpdates(currentVersion: string) {
  try {
    const { stdout } = await execPromise('npm view @musistudio/claude-code-router version')
    const latestVersion = stdout.trim()
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    const changelog = ''
    return { hasUpdate, latestVersion, changelog }
  } catch (error) {
    console.error('Error checking for updates:', error)
    return { hasUpdate: false, latestVersion: currentVersion, changelog: '' }
  }
}

export async function performUpdate() {
  try {
    const { stdout, stderr } = await execPromise('npm update -g @musistudio/claude-code-router')
    if (stderr) {
      console.error('Update stderr:', stderr)
    }
    console.log('Update stdout:', stdout)
    return {
      success: true,
      message: 'Update completed successfully. Please restart the application to apply changes.'
    }
  } catch (error) {
    console.error('Error performing update:', error)
    return {
      success: false,
      message: `Failed to perform update: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = i < parts1.length ? parts1[i] : 0
    const num2 = i < parts2.length ? parts2[i] : 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}
