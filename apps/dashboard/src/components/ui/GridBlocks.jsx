import React, { useMemo } from 'react';

export default function GridBlocks() {
  const blockSize = 60;
  
  // Generate random blocks once on mount
  const elements = useMemo(() => {
    const arr = [];
    const cols = 25;
    const rows = 25;
    
    // Generate filled blocks
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        // Higher probability of blocks towards the right side
        const prob = (x / cols) * 0.4;
        if (Math.random() < prob) {
          arr.push({ type: 'fill', x, y, opacity: Math.random() * 0.06 + 0.02 });
        }
      }
    }

    // Generate floating connected outline pairs
    for (let i = 0; i < 6; i++) {
      arr.push({
        type: 'outline-pair',
        x: Math.floor(Math.random() * (cols - 4)) + 2,
        y: Math.floor(Math.random() * (rows - 4)) + 2
      });
    }

    return arr;
  }, []);

  return (
    <div style={{ 
      position: 'absolute', 
      top: 0, left: 0, 
      width: '100%', height: '100%', 
      overflow: 'hidden', 
      zIndex: 0, 
      // Fade out the pattern on the left side where the text is
      maskImage: 'linear-gradient(to right, transparent 0%, black 40%)',
      WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 40%)' 
    }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid-pattern" width={blockSize} height={blockSize} patternUnits="userSpaceOnUse">
            {/* Very faint background grid lines */}
            <path d={`M ${blockSize} 0 L 0 0 0 ${blockSize}`} fill="none" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
          </pattern>
        </defs>
        
        <rect width="100%" height="100%" fill="url(#grid-pattern)" />
        
        <g>
          {elements.map((el, i) => {
            const px = el.x * blockSize;
            const py = el.y * blockSize;
            
            if (el.type === 'fill') {
              return (
                <rect 
                  key={i} 
                  x={px} y={py} 
                  width={blockSize} height={blockSize} 
                  fill={`rgba(0,0,0,${el.opacity})`} 
                />
              );
            } 
            
            if (el.type === 'outline-pair') {
              // Two overlapping rounded squares just like the reference image
              return (
                <g key={i}>
                  <rect 
                    x={px} y={py} 
                    width={blockSize * 0.8} height={blockSize * 0.8} 
                    fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" rx="8" 
                  />
                  <rect 
                    x={px + blockSize * 0.5} y={py + blockSize * 0.5} 
                    width={blockSize * 0.8} height={blockSize * 0.8} 
                    fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" rx="8" 
                  />
                </g>
              );
            }
            return null;
          })}
        </g>
      </svg>
    </div>
  );
}
