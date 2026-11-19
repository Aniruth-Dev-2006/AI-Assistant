const VERTEX_SHADER = `attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;

const CUSTOM_ORB_SHADER = `
precision highp float;
uniform vec2 iResolution; 
uniform float iTime;
uniform float uState; // 0.0 = idle, 1.0 = listening

// Hash function for noise
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// 2D Noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // Normalize coordinates centered at 0,0
    vec2 uv = (fragCoord.xy - 0.5 * iResolution.xy) / min(iResolution.x, iResolution.y);
    
    // Animate time (moves faster when listening state is 1.0)
    float t = iTime * mix(1.2, 3.0, uState); 
    
    // Fluid edge distortion using layered noise
    float n = noise(uv * 4.0 + t);
    float n2 = noise(uv * 4.0 - t * 0.8);
    vec2 distUv = uv + vec2(n - 0.5, n2 - 0.5) * mix(0.1, 0.25, uState);
    
    // Distance field for circle
    float dist = length(distUv);
    
    // Breathing radius
    float radius = mix(0.2, 0.25, sin(iTime * 1.5) * 0.5 + 0.5);
    
    // Core (solid inner dot)
    float core = smoothstep(radius, radius - 0.02, dist);
    
    // Glow (soft outer aura)
    float glow = smoothstep(radius + mix(0.15, 0.3, uState), radius - 0.05, dist);
    
    // Color mapping
    vec3 colorIdle = vec3(0.5, 0.5, 0.5); // Grey for idle
    vec3 colorListening = vec3(0.2, 0.6, 1.0); // Blue for listening
    vec3 colorSpeaking = vec3(1.0, 0.65, 0.1); // Warm Golden Yellow
    
    vec3 baseColor;
    if (uState < 1.0) {
        baseColor = mix(colorIdle, colorListening, uState);
    } else {
        baseColor = mix(colorListening, colorSpeaking, uState - 1.0);
    }
    
    // Combine core and glow
    vec3 finalColor = (baseColor * core) + (baseColor * glow * 0.6);
    
    // Calculate alpha transparency (fades to 0 at edges)
    float alpha = core + (glow * 0.7);
    alpha = clamp(alpha, 0.0, 1.0);
    
    // Fade out entirely if completely idle (0.0), or keep faint?
    // Let's keep a faint grey orb when idle.
    
    // Output premultiplied alpha (native transparent background)
    fragColor = vec4(finalColor * alpha, alpha);
}

void main() { 
    mainImage(gl_FragColor, gl_FragCoord.xy); 
}
`;

class SiriWave {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.size = options.size || 44;
    this.renderScale = options.renderScale || 2.0;
    this.state = 0.0; // 0.0 idle, 1.0 listening
    this.targetState = 0.0;
    this.raf = 0;
    
    // Enable alpha and premultiplied alpha to support transparent background properly
    this.gl = this.canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true });
    this.init();
  }

  // Called from renderer.js to toggle listening mode
  setState(state) {
    this.targetState = Number(state) || 0.0;
  }

  init() {
    const gl = this.gl;
    if (!gl) return;

    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    this.program = gl.createProgram();
    this.vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    this.fs = compile(gl.FRAGMENT_SHADER, CUSTOM_ORB_SHADER);
    gl.attachShader(this.program, this.vs);
    gl.attachShader(this.program, this.fs);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.uResolution = gl.getUniformLocation(this.program, "iResolution");
    this.uTime = gl.getUniformLocation(this.program, "iTime");
    this.uState = gl.getUniformLocation(this.program, "uState");

    const dim = Math.round(this.size * this.renderScale);
    this.canvas.width = dim;
    this.canvas.height = dim;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    gl.viewport(0, 0, dim, dim);

    this.start = Date.now();
    this.frame = this.frame.bind(this);
    this.frame();
  }

  frame() {
    const gl = this.gl;
    const now = Date.now();
    const t = (now - this.start) / 1000;
    
    // Smoothly animate state transitions between 0.0 and 1.0
    this.state += (this.targetState - this.state) * 0.1;

    const dim = Math.round(this.size * this.renderScale);
    gl.uniform2f(this.uResolution, dim, dim);
    gl.uniform1f(this.uTime, t);
    gl.uniform1f(this.uState, this.state);
    
    // Clear canvas cleanly
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.gl.deleteProgram(this.program);
    this.gl.deleteShader(this.vs);
    this.gl.deleteShader(this.fs);
    this.gl.deleteBuffer(this.buffer);
  }
}

window.SiriWave = SiriWave;
