import fs from 'fs/promises'
import path from 'path'
import { getGoModuleName } from '../utils/readGoMod'

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
  source: string
  destination: string
  name: string // Capitalized name (User)
  goConfig: GoConfigType
}

const copyFiles = async ({ name, source, destination, goConfig }: PayloadType) => {
  try {
    const files = await fs.readdir(source, { withFileTypes: true })

    // Create target directory if it doesn't exist
    await fs.mkdir(destination, { recursive: true })

    for (const file of files) {
      const sourcePath = path.join(source, file.name)
      const destinationPath = path.join(destination, file.name)

      if (file.isDirectory()) {
        // Recursively copy directory contents
        await copyFiles({
          source: sourcePath,
          destination: destinationPath,
          name,
          goConfig,
        })
      } else {
        // Copy file with replacements
        const fileContent = await fs.readFile(sourcePath, 'utf-8')
        
        // Get the actual module name from go.mod
        const actualModuleName = await getGoModuleName('../../..')
        
        // Replace Sample/sample with actual feature name and module path
        const updatedContent = fileContent
          .replace(/Sample/g, name) // Sample -> User
          .replace(/sample/g, name.toLowerCase()) // sample -> user
          .replace(/SAMPLE/g, name.toUpperCase()) // SAMPLE -> USER
          .replace(/SAMPLE_MODULE_PATH/g, actualModuleName) // SAMPLE_MODULE_PATH -> github.com/m1max/counter

        await fs.writeFile(destinationPath, updatedContent, 'utf-8')
      }
    }
  } catch (err) {
    console.error(`Error while copying feature files: ${err}`)
  }
}

const updateProviderFile = async (
  filePath: string, 
  insertAfter: string, 
  template: string, 
  moduleInsert?: string
) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    
    // Add provider function after the insertAfter line
    let updatedContent = content.replace(
      insertAfter,
      insertAfter + template
    )

    // Add to fx.Provide if moduleInsert is provided
    if (moduleInsert) {
      updatedContent = updatedContent.replace(
        insertAfter,
        insertAfter + `\n\tfx.Provide(${moduleInsert}),`
      )
    }

    await fs.writeFile(filePath, updatedContent, 'utf-8')
  } catch (err) {
    console.error(`Error updating provider file ${filePath}: ${err}`)
  }
}

const addImports = async (filePath: string, featureName: string, goConfig: GoConfigType) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const lowerFeatureName = featureName.toLowerCase()
    
    // Get actual module name instead of hardcoded one
    const actualModuleName = await getGoModuleName('../../..')
    const featureBase = goConfig.importPath.featureBase
    const importToAdd = `\t"${actualModuleName}/${featureBase}/${lowerFeatureName}/domain/repository"\n\t"${actualModuleName}/${featureBase}/${lowerFeatureName}/infrastructure/persistence"`
    
    // Find the import block and add our imports
    const updatedContent = content.replace(
      /import \(/,
      `import (\n${importToAdd}`
    )

    await fs.writeFile(filePath, updatedContent, 'utf-8')
  } catch (err) {
    console.error(`Error adding imports to ${filePath}: ${err}`)
  }
}

export const createFeature = async (payload: PayloadType) => {
  const { name, source, destination, goConfig } = payload
  const lowerName = name.toLowerCase()

  // Step 1: Copy template files
  await copyFiles({ name, source, destination, goConfig })

  // Step 2: Update provider files with DI
  const { repository, usecase, handler, database } = goConfig.diInjection

  // Add repository provider
  const repoTemplate = repository.providerTemplate
    .replace(/Sample/g, name)
    .replace(/sample/g, lowerName)
  await updateProviderFile(
    repository.file, 
    repository.insertAfter, 
    repoTemplate,
    repository.moduleInsert.replace(/Sample/g, name)
  )

  // Add usecase provider
  const usecaseTemplate = usecase.providerTemplate
    .replace(/Sample/g, name)
    .replace(/sample/g, lowerName)
  await updateProviderFile(
    usecase.file, 
    usecase.insertAfter, 
    usecaseTemplate,
    usecase.moduleInsert.replace(/Sample/g, name)
  )

  // Add handler provider
  const handlerTemplate = handler.providerTemplate
    .replace(/Sample/g, name)
    .replace(/sample/g, lowerName)
  await updateProviderFile(
    handler.file, 
    handler.insertAfter, 
    handlerTemplate,
    handler.moduleInsert.replace(/Sample/g, name)
  )

  // Add database migration
  const migrationTemplate = database.migrationTemplate
    .replace(/Sample/g, name)
    .replace(/sample/g, lowerName)
  await updateProviderFile(
    database.file, 
    database.insertAfter, 
    migrationTemplate
  )

  // Step 3: Add imports to provider files
  await addImports(repository.file, name, goConfig)
  await addImports(usecase.file, name, goConfig)
  await addImports(handler.file, name, goConfig)

  console.log('\x1b[36m', `Go feature ${name} created successfully`, '\x1b[0m')
}