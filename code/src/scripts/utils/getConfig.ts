import fs from 'fs'
import path from 'path'
import { ConfigType } from './lib/types'

// Путь к корневой директории проекта
const rootDir = process.cwd()

const CONFIG_VARIANTS = ['.config.template.cjs', '.config.template.js', '.config.template.mjs']

const resolveConfigPath = () => {
  for (const fileName of CONFIG_VARIANTS) {
    const candidate = path.join(rootDir, fileName)

    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export const getConfig = (): ConfigType | undefined => {
  const configPath = resolveConfigPath()

  if (configPath) {
    return require(configPath)
  }

  console.error(
    'Конфигурационный файл .config.template.cjs или .config.template.js не найден!'
  )
}
