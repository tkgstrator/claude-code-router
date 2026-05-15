/**
 * 预设功能 CLI 层
 * 导出所有预设相关的功能和类型
 */

// 从 shared 包重新导出类型和核心功能
export * from '@ccr/shared'
export { handlePresetCommand } from './commands'
// 导出 CLI 特定的功能（带交互）
export { exportPresetCli } from './export'
export { applyPresetCli, installPresetCli } from './install'
