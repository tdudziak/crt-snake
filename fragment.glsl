#version 300 es
precision mediump float;
precision mediump usampler2D;

uniform usampler2D cells;
uniform int N;
uniform float timestamp;
in vec2 screenCoord;
out vec4 fragColor;

const vec2 NARROW = vec2(0.3, 0.7);
const vec2 WIDE = vec2(0.2, 0.8);
const float WARP = 0.8;
const float TIME_LIMIT = 10.0; // seconds before it's all noise

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

void main() {
    // map coordinates to create a wrapped CRT effect
    vec2 coord = screenCoord;
    vec2 dc = abs(0.5 - coord);
    dc *= dc;
    coord.x -= 0.5; coord.x *= 1.0 + (dc.y * (0.3 * WARP)); coord.x += 0.5;
    coord.y -= 0.5; coord.y *= 1.0 + (dc.x * (0.4 * WARP)); coord.y += 0.5;
    if (!(all(greaterThan(coord, vec2(0.0))) && all(lessThan(coord, vec2(1.0))))) {
        discard;
    }

    int bmask = int(texture(cells, coord).r);
    vec2 off = fract(coord * float(N));

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
    vec3 color = vec3(float(pix_set));

    if (timestamp < 0.15) {
        // first 150ms are a transition with pure noise
        color = vec3(analogVideoNoise(coord, timestamp));
    } else {
        // inject random white noise
        float noise = whiteNoise(vec3(coord, timestamp));
        float noiseMix = 2.0 * (log(1.0 + 1.7182 * timestamp / TIME_LIMIT)) - noise1d(timestamp * 0.1);
        noiseMix = clamp(noiseMix, 0.0, 1.0);
        color = mix(color, vec3(noise), noiseMix);
    }

    // add a scanline effect
    float scan_line = abs(sin(coord.y * 480.0) * 0.8);
    color *= scan_line;

    // apply a vignette with a sudden dropoff at the edges
    color *= 0.1 + vec3(1.0 / (1.0 + exp(20.0 * (-0.25 + length(dc)))));

    fragColor = vec4(color, 1.0);
}
