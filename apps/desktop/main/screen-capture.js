const { BrowserWindow, ipcMain, desktopCapturer, screen, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
class ScreenCaptureManager {
    constructor(mainWindow, llmClient) {
        this.mainWindow = mainWindow;
        this.llmClient = llmClient;
        this.captureWindow = null;
        this.ocrInstance = null;
        this.isOcrLoading = false;
        
        ipcMain.on('capture:start', () => this.startCaptureMode());
        ipcMain.on('capture:cancel', () => this.stopCaptureMode());
        ipcMain.on('capture:coordinates', (event, coords) => this.handleCoordinates(coords));
    }

    async getOcrInstance() {
        return null;
    }

    startCaptureMode() {
        if (this.captureWindow) return;

        // Preload OCR in the background so it's ready when they finish dragging
        this.getOcrInstance();

        const display = screen.getPrimaryDisplay();
        const { width, height } = display.bounds;

        this.captureWindow = new BrowserWindow({
            width,
            height,
            x: display.bounds.x,
            y: display.bounds.y,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        this.captureWindow.loadFile(path.join(__dirname, '../renderer/capture-overlay.html'));
        this.captureWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    stopCaptureMode() {
        if (this.captureWindow) {
            this.captureWindow.close();
            this.captureWindow = null;
        }
    }

    async handleCoordinates(coords) {
        this.stopCaptureMode();
        this.mainWindow.webContents.send('status', { message: 'Extracting text with AI...' });
        
        try {
            const sources = await desktopCapturer.getSources({ 
                types: ['screen'],
                thumbnailSize: screen.getPrimaryDisplay().bounds
            });
            
            const image = sources[0].thumbnail;
            let croppedImage = image.crop(coords);
            let size = croppedImage.getSize();
            
            // Resize to prevent ONNX memory allocation errors on large screens
            if (size.width > 1200 || size.height > 1200) {
                const ratio = Math.min(1200 / size.width, 1200 / size.height);
                croppedImage = croppedImage.resize({
                    width: Math.floor(size.width * ratio),
                    height: Math.floor(size.height * ratio)
                });
                size = croppedImage.getSize();
                console.log(`[OCR] Scaled image down to ${size.width}x${size.height} to save memory.`);
            }
            
            const base64Img = `data:image/png;base64,${croppedImage.toPNG().toString('base64')}`;
            this.mainWindow.webContents.send('status', { message: 'Image captured (Local OCR disabled)' });
            this.mainWindow.webContents.send('ocr:result', { text: '', image: base64Img });
            
        } catch (err) {
            console.error('[Screen Capture] Error:', err);
            this.mainWindow.webContents.send('status', { message: 'OCR extraction failed.' });
        }
    }
}

module.exports = ScreenCaptureManager;
