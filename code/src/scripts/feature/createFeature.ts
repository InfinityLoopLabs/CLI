import fs from 'fs/promises'
import path from 'path'

type GoConfigType = {
  goModPath: string
  importPath: {
    modulePrefix: string
    featureBase: string
  }
  diInjection: {
    database: {
      file: string
      insertAfter: string
      migrationTemplate: string
    }
    mainModule: {
      file: string
      insertAfter: string
      moduleImport: string
      moduleInsert: string
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

        // Get the actual module name from config
        const actualModuleName = goConfig.importPath.modulePrefix

        // Replace Sample/sample with actual feature name and module path
        const updatedContent = fileContent
          .replace(/Sample/g, name) // Sample -> User
          .replace(/sample/g, name.toLowerCase()) // sample -> user
          .replace(/SAMPLE/g, name.toUpperCase()) // SAMPLE -> USER
          .replace(/SAMPLE_MODULE_PATH/g, actualModuleName) // SAMPLE_MODULE_PATH -> github.com/m1max/counter
          // Also replace any generated placeholders that might have been created
          .replace(new RegExp(`${name.toUpperCase()}_MODULE_PATH`, 'g'), actualModuleName)

        await fs.writeFile(destinationPath, updatedContent, 'utf-8')
      }
    }
  } catch (err) {
    console.error(`Error while copying feature files: ${err}`)
  }
}

const updateFile = async (
  filePath: string,
  insertAfter: string,
  content: string
) => {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8')

    const updatedContent = fileContent.replace(
      insertAfter,
      insertAfter + '\n\t' + content
    )

    await fs.writeFile(filePath, updatedContent, 'utf-8')
  } catch (err) {
    console.error(`Error updating file ${filePath}: ${err}`)
  }
}

const addImportToMainGo = async (filePath: string, featureName: string, goConfig: GoConfigType) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const lowerFeatureName = featureName.toLowerCase()

    // Get actual module name from config
    const actualModuleName = goConfig.importPath.modulePrefix
    const featureBase = goConfig.importPath.featureBase
        //TODO: add featureBase to config
    const importToAdd = `${lowerFeatureName}Module "${actualModuleName}/${featureBase}/${lowerFeatureName}"`

    // Find the import block and add our import after existing imports
    const updatedContent = content.replace(
      /"go\.uber\.org\/zap"/,
      `"go.uber.org/zap"\n\t${importToAdd}`
    )

    await fs.writeFile(filePath, updatedContent, 'utf-8')
  } catch (err) {
    console.error(`Error adding import to ${filePath}: ${err}`)
  }
}

export const createFeature = async (payload: PayloadType) => {
  const { name, source, destination, goConfig } = payload
  const lowerName = name.toLowerCase()

  // Step 1: Copy template files
  await copyFiles({ name, source, destination, goConfig })

  // Step 2: Update database migrations
  const { database, mainModule } = goConfig.diInjection

  // Add database migration
  const migrationTemplate = database.migrationTemplate
    .replace(/Sample/g, name)
    .replace(/sample/g, lowerName)
  await updateFile(
    database.file,
    database.insertAfter,
    migrationTemplate
  )

  // Step 3: Add feature module to main.go
  const moduleImport = mainModule.moduleImport
    .replace(/SAMPLE_MODULE_PATH/g, goConfig.importPath.modulePrefix)
    .replace(/sample/g, lowerName)
  const moduleInsert = mainModule.moduleInsert
    .replace(/sample/g, lowerName)

  // Add import to main.go
  await addImportToMainGo(mainModule.file, name, goConfig)

  // Add module to fx.New
  await updateFile(
    mainModule.file,
    mainModule.insertAfter,
    moduleInsert
  )

  console.log('\x1b[36m', `Go feature ${name} created successfully`, '\x1b[0m')
}
