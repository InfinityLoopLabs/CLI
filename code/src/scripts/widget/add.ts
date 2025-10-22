import fs from 'fs/promises'
import path from 'path'

type PayloadType = {
  source: string
  destination: string
  name: string
}

const copyFiles = async ({ name, source, destination }: PayloadType) => {
  const lowerCaseName = name ? name[0].toLowerCase() + name.slice(1) : name
  // const destination = `${d}/${name}/`
  try {
    const files = await fs.readdir(source, { withFileTypes: true })

    // Создание целевой директории, если она не существует
    await fs.mkdir(destination, { recursive: true })

    for (const file of files) {
      const sourcePath = path.join(source, file.name)
      const destinationPath = path.join(destination, file.name)

      if (file.isDirectory()) {
        // Если текущий файл является директорией, рекурсивно копируем его содержимое
        await copyFiles({
          source: sourcePath,
          destination: destinationPath,
          name,
        })
      } else {
        // Если текущий файл является файлом
        const fileContent = await fs.readFile(sourcePath, 'utf-8')
        const updatedContent = fileContent.replace(/Sample|sample/g, (match) => {
          if (match === 'Sample') {
            return name
          }

          if (match === 'sample') {
            return lowerCaseName
          }

          return match
        })

        if (updatedContent !== fileContent) {
          await fs.writeFile(destinationPath, updatedContent, 'utf-8')
        } else {
          await fs.copyFile(sourcePath, destinationPath)
        }
      }
    }
  } catch (err) {
    console.error(`Error while clone widget: ${err}`)
  }
}

export const createWidget = async (payload: PayloadType) => {
  await copyFiles(payload)
  console.log('\x1b[36m', `Widget ${payload.name} created`, '\x1b[0m')
}
