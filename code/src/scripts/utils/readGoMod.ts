import fs from 'fs/promises'
import path from 'path'

export const getGoModuleName = async (projectRoot: string = '..'): Promise<string> => {
  try {
    const goModPath = path.resolve(__dirname, projectRoot, 'go.mod')
    const content = await fs.readFile(goModPath, 'utf-8')
    
    // Extract module name from first line: "module github.com/m1max/counter"
    const moduleMatch = content.match(/^module\s+(.+)$/m)
    
    if (!moduleMatch) {
      throw new Error('Could not find module declaration in go.mod')
    }
    
    return moduleMatch[1].trim()
  } catch (err) {
    console.error('Error reading go.mod:', err)
    throw new Error('Failed to read Go module name from go.mod')
  }
}