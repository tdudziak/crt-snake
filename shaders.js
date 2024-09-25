export const initShaders = function initShaders(gl) {

// one common vertex shader for all stages
const vertexShaderSource = `#version 300 es
    in vec2 position;
    in vec2 texcoord;
    out vec2 screenCoord;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        screenCoord = texcoord;
    }
`;

// common header for all fragment shaders
const commonHeader = `#version 300 es

precision mediump float;
precision mediump usampler2D;

uniform int N;
uniform float timestamp;
uniform float noiseLevel;

in vec2 screenCoord;
out vec4 fragColor;

// hashing 3d white noise
float whiteNoise(vec3 coord) {
    return fract(sin(dot(fract(coord), vec3(12.9898, 78.233, 45.543))) * 43758.5453);
}

// continuous and relatively smooth periodic 1D noise
float noise1d(float x) {
    x = fract(x);
    const vec4 SEED = vec4(0.20704028, 0.21762754, 0.55062136, 0.06538987);
    const vec4 F = vec4(2.0, 4.0, 8.0, 16.0);
    vec4 y = 0.5 + 0.5 * sin(2.0 * 3.14 * (F * vec4(x) + SEED)) / F;
    return (y.x + y.y + y.z + y.w) * 0.25;
}

float analogVideoNoise(vec2 uv, float t) {
    float bands = 0.8 + sin(dot(vec3(uv, fract(t)), vec3(20.0, 20.0 * noise1d(t), 50.0)));
    return clamp(bands, 0.0, 1.0) * whiteNoise(vec3(uv, fract(t)));
}
`;

function createProgram(fragmentSource) {
    let compileShader = function(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            throw new Error('Shader compilation error');
        }
        return shader;
    }
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, commonHeader + fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        throw new Error('Program linking error');
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
};


const stage1 = createProgram(`
uniform usampler2D stageIn;
const vec2 NARROW = vec2(0.3, 0.7);
const vec2 WIDE = vec2(0.2, 0.8);

void main() {
    int bmask = int(texture(stageIn, screenCoord).r);
    vec2 off = fract(screenCoord * float(N));

    // see BM_* constants in the JS code
    bool top = (bmask & 1) != 0;
    bool bot = (bmask & 2) != 0;
    bool left = (bmask & 4) != 0;
    bool right = (bmask & 8) != 0;
    bool seg = (bmask & 16) != 0;
    bool apple = (bmask & 32) != 0;

    bool pix_horizontal = off.x > NARROW.x && off.x < NARROW.y;
    bool pix_vertical = off.y > NARROW.x && off.y < NARROW.y;

    bool pix_set =
        (seg && pix_horizontal && pix_vertical) ||
        (apple && all(greaterThan(off, WIDE.xx)) && all(lessThan(off, WIDE.yy))) ||
        (top && pix_horizontal && off.y > NARROW.y) ||
        (bot && pix_horizontal && off.y < NARROW.x) ||
        (left && pix_vertical && off.x < NARROW.x) ||
        (right && pix_vertical && off.x > NARROW.y);

    if (noiseLevel >= 1.0) {
        // all noise with some additional analog effects
        fragColor = vec4(vec3(analogVideoNoise(screenCoord, timestamp)), 1.0);
    } else {
        float value = mix(float(pix_set), whiteNoise(vec3(screenCoord.xy, timestamp)), noiseLevel);
        fragColor = vec4(value);
    }
}
`);

const stage2 = createProgram(`
uniform sampler2D stageIn;
const float WARP = 0.8;

void main() {
    vec2 coord = screenCoord;
    vec2 dc = abs(0.5 - coord);
    dc *= dc;
    coord.x -= 0.5; coord.x *= 1.0 + (dc.y * (0.3 * WARP)); coord.x += 0.5;
    coord.y -= 0.5; coord.y *= 1.0 + (dc.x * (0.4 * WARP)); coord.y += 0.5;
    if (!(all(greaterThan(coord, vec2(0.0))) && all(lessThan(coord, vec2(1.0))))) {
        discard;
    }

    vec3 color = texture(stageIn, coord).rgb;

    // apply a slight vignette effect
    color *= 0.5 + 0.5 * clamp(1.0 - (3.0 * length(dc)), 0.0, 1.0);

    fragColor = vec4(color, 1.0);
}
`);

const bloom = createProgram(`
uniform sampler2D stageIn;
uniform vec2 bloomAxis;

const float COEF_CENTER = 0.3;
const vec3 HALF_KERNEL = vec3(0.3, 0.1, 0.05);

float inAt(vec2 dxy) {
    return texture(stageIn, screenCoord + dxy).r;
}

void main() {
    float dc = dot(0.5 - screenCoord, 0.5 - screenCoord);
    vec2 dxy = bloomAxis * 0.0015 * (1.0 + 2.0 * dc);
    float in_center = texture(stageIn, screenCoord).r;
    vec3 in_left = vec3(inAt(-1.0 * dxy), inAt(-2.0 * dxy), inAt(-3.0 * dxy));
    vec3 in_right = vec3(inAt(1.0 * dxy), inAt(2.0 * dxy), inAt(3.0 * dxy));

    float result = dot(HALF_KERNEL, in_left + in_right) + COEF_CENTER * in_center;
    fragColor = vec4(result, result, result, 1.0);
}
`);

return {
    stage1,
    stage2,
    bloom
};
}
