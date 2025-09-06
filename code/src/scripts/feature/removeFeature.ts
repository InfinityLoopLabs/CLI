import * as path from 'path'
import fs from 'fs/promises'
import { deleteDirectory } from '../utils/removeFolder'

type GoConfigType = {
  importPath: {
    modulePrefix: string
    featureBase: string
  }
  diInjection: {
    repository: {
      file: string
      insertAfter: string
      providerTemplate: string
      moduleInsert: string
    }
    usecase: {
      file: string
      insertAfter: string
      providerTemplate: string
      moduleInsert: string
    }
    handler: {
      file: string
      insertAfter: string
      providerTemplate: string
      moduleInsert: string
    }
    database: {
      file: string
      insertAfter: string
      migrationTemplate: string
    }
  }
}

type PayloadType = {
  destination: string
  name: string
  goConfig: GoConfigType
}

const removeFromProviderFile = async (filePath: string, featureName: string, goConfig: GoConfigType) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    
    // Remove provider function
    const functionRegex = new RegExp(
      `\\n\\nfunc Provide${featureName}[\\s\\S]*?\\n}`,
      'g'
    )
    
    // Remove from fx.Provide
    const provideRegex = new RegExp(
      `\\n\\s*fx\\.Provide\\(Provide${featureName}[^,]*\\),?`,
      'g'
    )
    
    // Remove imports related to this feature using config paths
    const modulePrefix = goConfig.importPath.modulePrefix
    const featureBase = goConfig.importPath.featureBase
    const lowerFeatureName = featureName.toLowerCase()
    const importRegex = new RegExp(
      `\\n\\s*"${modulePrefix}/${featureBase}/${lowerFeatureName}/[^"]*"`,
      'g'
    )

    let updatedContent = content
      .replace(functionRegex, '')
      .replace(provideRegex, '')
      .replace(importRegex, '')

    await fs.writeFile(filePath, updatedContent, 'utf-8')
  } catch (err) {
    console.error(`Error removing from provider file ${filePath}: ${err}`)
  }
}

const removeFromDatabase = async (filePath: string, featureName: string) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    
    // Remove migration line
    const migrationRegex = new RegExp(
      `\\n\\s*&${featureName.toLowerCase()}persistence\\.${featureName}Model{},?`,
      'g'
    )

    const updatedContent = content.replace(migrationRegex, '')
    await fs.writeFile(filePath, updatedContent, 'utf-8')
  } catch (err) {
    console.error(`Error removing from database file ${filePath}: ${err}`)
  }
}

export const removeFeature = async (payload: PayloadType) => {
  const { name, destination, goConfig } = payload
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)

  // Step 1: Remove feature directory
  await deleteDirectory(path.join(destination, name))

  // Step 2: Clean up provider files
  const { repository, usecase, handler, database } = goConfig.diInjection

  await removeFromProviderFile(repository.file, capitalizedName, goConfig)
  await removeFromProviderFile(usecase.file, capitalizedName, goConfig)
  await removeFromProviderFile(handler.file, capitalizedName, goConfig)
  await removeFromDatabase(database.file, capitalizedName)

  console.log('\x1b[36m', `Go feature ${capitalizedName} removed successfully`, '\x1b[0m')
}