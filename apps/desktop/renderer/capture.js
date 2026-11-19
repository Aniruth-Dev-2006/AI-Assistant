const { ipcRenderer } = require('electron');

let startX, startY, isSelecting = false;
const selectionBox = document.getElementById('selection-box');
const instructions = document.getElementById('instructions');

window.addEventListener('mousedown', (e) => {
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
    
    instructions.style.display = 'none';
});

window.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    selectionBox.style.left = x + 'px';
    selectionBox.style.top = y + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
});

window.addEventListener('mouseup', (e) => {
    if (!isSelecting) return;
    isSelecting = false;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    // Minimum size check to prevent accidental clicks
    if (width > 20 && height > 20) {
        // Provide the coordinates relative to the screen to the main process
        ipcRenderer.send('capture:coordinates', {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height)
        });
    } else {
        // Reset if it was just a click
        selectionBox.style.display = 'none';
        instructions.style.display = 'block';
    }
});

// Allow cancelling with escape key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        ipcRenderer.send('capture:cancel');
    }
});
