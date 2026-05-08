import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export class WindowManager {
  private mainWindow: BrowserWindow | null = null

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow
    }

    const nextWindow = new BrowserWindow({
      width: 900,
      height: 670,
      show: false,
      title: '自由问答',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        preload: join(__dirname, '../preload/index.js'),
        devTools: true
      }
    })

    nextWindow.on('ready-to-show', () => {
      nextWindow.show()
    })

    nextWindow.on('closed', () => {
      if (this.mainWindow === nextWindow) {
        this.mainWindow = null
      }
    })

    nextWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      nextWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      nextWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.mainWindow = nextWindow
    return nextWindow
  }
}
